import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../app/chatgpt-auth";
import { ApiError, calculateTotal, parseDateRange, shanghaiDate } from "./domain";
import type { AppSettings, NewOrderInput, Order, OrderMode, OrderStatus } from "./domain";

export const DEFAULT_SETTINGS: AppSettings = { storeName: "石小满 · 石锅拌饭", prepMinutes: 15 };

export function database(): D1Database {
  if (!env.DB) throw new ApiError("订单数据库暂未准备好，请稍后再试", 503);
  return env.DB;
}

export async function authorize(request: Request, mutation = false) {
  const user = await getChatGPTUser();
  if (!user) throw new ApiError("请先登录后使用门店工作台", 401);
  if (mutation) {
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") throw new ApiError("请从当前门店页面提交操作", 403);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new ApiError("请求须使用 JSON 格式", 415);
  }
  return user;
}

export async function readBody(request: Request): Promise<unknown> {
  const max = 512 * 1024;
  const length = request.headers.get("content-length");
  if (length && Number(length) > max) throw new ApiError("导入文件过大，最大允许 512 KB", 413);
  if (!request.body) throw new ApiError("请求内容不能为空");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); throw new ApiError("导入文件过大，最大允许 512 KB", 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let cursor = 0;
  for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.length; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new ApiError("JSON 格式不正确，请检查导入内容"); }
}

export function result(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export function failure(error: unknown): Response {
  if (error instanceof ApiError) return result({ error: error.message }, error.status);
  console.error("Order service failure", error instanceof Error ? error.name : "Unknown error");
  return result({ error: "服务暂时不可用，请稍后重试；订单不会在失败时自动流转" }, 500);
}

export async function settingsFor(ownerId: string): Promise<AppSettings> {
  const row = await database().prepare("SELECT store_name, prep_minutes FROM store_settings WHERE owner_id = ?").bind(ownerId).first<{ store_name: string; prep_minutes: number }>();
  return row ? { storeName: row.store_name, prepMinutes: row.prep_minutes } : { ...DEFAULT_SETTINGS };
}

export function createOrder(input: NewOrderInput, mode: OrderMode, prepMinutes: number, actor: string, now = Date.now()): Order {
  const id = crypto.randomUUID();
  return { id, number: `${shanghaiDate(now).slice(5).replace("-", "")}-${id.slice(0, 8).toUpperCase()}`, externalId: input.externalId ?? `manual-${id}`, channel: input.channel, customerName: input.customerName, deliveryType: input.deliveryType, note: input.note, items: input.items, amountCents: calculateTotal(input.items), status: "new", createdAt: now, dueAt: now + (input.prepMinutes ?? prepMinutes) * 60000, updatedAt: now, version: 1, isDemo: mode === "demo", events: [{ status: "new", at: now, actor }] };
}

export function insertStatement(ownerId: string, order: Order) {
  return database().prepare("INSERT INTO orders (id, owner_id, is_demo, channel, external_id, status, created_at, version, amount_cents, document) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (owner_id, is_demo, channel, external_id) DO NOTHING").bind(order.id, ownerId, order.isDemo ? 1 : 0, order.channel, order.externalId, order.status, order.createdAt, order.version, order.amountCents, JSON.stringify(order));
}

export function demoOrders(actor: string, prepMinutes: number, now = Date.now()): Order[] {
  const day = shanghaiDate(now);
  const { start } = parseDateRange(day);
  // Fictional demonstration menu and prices; these are not the store's actual prices.
  const samples: { status: OrderStatus; minutes: number; name: string; note: string; quantity: number; spec?: string; unitPriceCents?: number }[] = [
    { status: "new", minutes: 2, name: "招牌部队锅", spec: "单人锅 · 微辣", unitPriceCents: 3290, note: "年糕煮软一些，芝士单独放（演示订单，价格仅为示例）", quantity: 1 },
    { status: "new", minutes: 4, name: "韩式泡菜五花肉拌饭", note: "酱汁分装，谢谢", quantity: 2 },
    { status: "preparing", minutes: 18, name: "招牌部队锅", spec: "双人分享锅 · 中辣", unitPriceCents: 5890, note: "年糕煮软一些，芝士单独放（演示订单，价格仅为示例）", quantity: 1 },
    { status: "preparing", minutes: 11, name: "招牌肥牛石锅拌饭", note: "加一份锅巴", quantity: 2 },
    { status: "preparing", minutes: 7, name: "香煎鸡腿石锅拌饭", note: "不要洋葱", quantity: 1 },
    { status: "ready", minutes: 20, name: "韩式泡菜五花肉拌饭", note: "餐具两份", quantity: 2 },
    { status: "ready", minutes: 16, name: "菌菇蔬菜石锅拌饭", note: "自取订单，请保持温热", quantity: 1 },
    { status: "handed_over", minutes: 30, name: "招牌肥牛石锅拌饭", note: "", quantity: 1 },
  ];
  return samples.map((sample, index) => {
    const createdAt = Math.max(start + 1, now - sample.minutes * 60000);
    const order = createOrder({ channel: "manual", customerName: `演示顾客 ${String.fromCharCode(65 + index)}`, deliveryType: index === 6 ? "pickup" : "delivery", note: sample.note, items: [{ name: sample.name, spec: sample.spec ?? (index % 2 ? "标准份 · 微辣" : "标准份 · 少辣"), quantity: sample.quantity, unitPriceCents: sample.unitPriceCents ?? (index === 6 ? 2290 : 2690) }] }, "demo", prepMinutes, actor, createdAt);
    order.channel = "demo";
    order.externalId = `demo-${day}-${index + 1}`;
    order.number = String(1041 + index);
    order.status = sample.status;
    const progression: OrderStatus[] = sample.status === "new" ? [] : sample.status === "preparing" ? ["preparing"] : sample.status === "ready" ? ["preparing", "ready"] : ["preparing", "ready", "handed_over"];
    progression.forEach((status, step) => { order.events.push({ status, at: Math.min(now, createdAt + (step + 1) * 60000), actor }); });
    order.updatedAt = order.events.at(-1)!.at;
    order.version = order.events.length;
    return order;
  });
}
