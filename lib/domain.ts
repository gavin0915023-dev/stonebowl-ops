export type OrderStatus = "new" | "preparing" | "ready" | "handed_over" | "cancelled";
export type OrderMode = "demo" | "live";
export type OrderItem = { name: string; spec: string; quantity: number; unitPriceCents: number };
export type OrderEvent = { status: string; at: number; actor: string; reason?: string };
export type AppSettings = { storeName: string; prepMinutes: number };
export type Order = {
  id: string; number: string; externalId: string;
  channel: "demo" | "manual" | "meituan-import";
  customerName: string; deliveryType: "delivery" | "pickup"; note: string;
  items: OrderItem[]; amountCents: number; status: OrderStatus;
  createdAt: number; dueAt: number; updatedAt: number; version: number;
  isDemo: boolean; events: OrderEvent[];
};
export type NewOrderInput = {
  externalId?: string; channel: "manual" | "meituan-import";
  customerName: string; deliveryType: "delivery" | "pickup"; note: string;
  items: OrderItem[]; prepMinutes?: number;
};

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; this.name = "ApiError"; }
}

export function record(value: unknown, label = "请求"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(`${label}必须是对象`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, maximum: number, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string") throw new ApiError(`${label}格式不正确`);
  const result = value.trim();
  if (result.length > maximum || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(result)) throw new ApiError(`${label}过长或含无效字符`);
  return result;
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new ApiError(`${label}须为 ${minimum}–${maximum} 之间的整数`);
  return value;
}

export function parseMode(value: unknown): OrderMode {
  if (value !== "demo" && value !== "live") throw new ApiError("请选择演示或营业模式");
  return value;
}

export function shanghaiDate(timestamp = Date.now()): string {
  if (!Number.isFinite(timestamp)) throw new ApiError("时间无效");
  const d = new Date(timestamp + 8 * 3600000);
  if (Number.isNaN(d.getTime())) throw new ApiError("时间无效");
  return d.toISOString().slice(0, 10);
}

export function parseDateRange(date: string): { start: number; end: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new ApiError("日期格式须为 YYYY-MM-DD");
  const start = Date.parse(`${date}T00:00:00+08:00`);
  if (!Number.isFinite(start) || shanghaiDate(start) !== date) throw new ApiError("日期无效");
  return { start, end: start + 86400000 };
}

export function calculateTotal(items: OrderItem[]): number {
  if (!Array.isArray(items) || items.length < 1 || items.length > 40) throw new ApiError("每单须包含 1–40 项菜品");
  let amount = 0;
  for (const item of items) {
    amount += integer(item.quantity, "菜品数量", 1, 99) * integer(item.unitPriceCents, "菜品单价（分）", 0, 1000000);
    if (!Number.isSafeInteger(amount) || amount > 100000000) throw new ApiError("订单金额超出允许范围");
  }
  return amount;
}

export function parseNewOrder(value: unknown, requireExternalId = false): NewOrderInput {
  const input = record(value, "订单");
  const allowed = new Set(["mode", "externalId", "channel", "customerName", "deliveryType", "note", "items", "prepMinutes"]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new ApiError(`订单包含不支持的字段：${key}`);
  const channel = input.channel ?? "manual";
  if (channel !== "manual" && channel !== "meituan-import") throw new ApiError("订单来源无效");
  const externalId = text(input.externalId, "外部订单号", 100, "");
  if ((requireExternalId || channel === "meituan-import") && !externalId) throw new ApiError("导入订单必须填写外部订单号");
  const customerName = text(input.customerName, "顾客称呼", 40, "顾客");
  if (!customerName) throw new ApiError("请填写顾客称呼");
  const deliveryType = input.deliveryType ?? "delivery";
  if (deliveryType !== "delivery" && deliveryType !== "pickup") throw new ApiError("取餐方式无效");
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 40) throw new ApiError("每单须包含 1–40 项菜品");
  const items = input.items.map((raw) => {
    const item = record(raw, "菜品");
    if (Object.keys(item).some((key) => !["name", "spec", "quantity", "unitPriceCents"].includes(key))) throw new ApiError("菜品包含不支持的字段");
    const name = text(item.name, "菜品名称", 100);
    if (!name) throw new ApiError("菜品名称不能为空");
    return { name, spec: text(item.spec, "菜品规格", 100, ""), quantity: integer(item.quantity, "菜品数量", 1, 99), unitPriceCents: integer(item.unitPriceCents, "菜品单价（分）", 0, 1000000) };
  });
  calculateTotal(items);
  return { externalId: externalId || undefined, channel, customerName, deliveryType, note: text(input.note, "订单备注", 500, ""), items, prepMinutes: input.prepMinutes === undefined ? undefined : integer(input.prepMinutes, "预计制作分钟", 3, 120) };
}

export function validateImport(value: unknown): { mode: OrderMode; orders: NewOrderInput[] } {
  const input = record(value);
  if (Object.keys(input).some((key) => !["mode", "orders"].includes(key))) throw new ApiError("导入包含不支持的字段");
  if (!Array.isArray(input.orders) || input.orders.length < 1 || input.orders.length > 100) throw new ApiError("每次请导入 1–100 笔订单");
  return { mode: parseMode(input.mode), orders: input.orders.map((order) => parseNewOrder(order, true)) };
}

export function parseSettings(value: unknown): AppSettings {
  const input = record(value);
  if (Object.keys(input).some((key) => !["storeName", "prepMinutes"].includes(key))) throw new ApiError("设置包含不支持的字段");
  const storeName = text(input.storeName, "门店名称", 60);
  if (!storeName) throw new ApiError("门店名称不能为空");
  return { storeName, prepMinutes: integer(input.prepMinutes, "预计制作分钟", 3, 120) };
}

export function assertTransition(from: OrderStatus, to: OrderStatus, cancelReason?: string): void {
  const transitions: Record<OrderStatus, readonly OrderStatus[]> = { new: ["preparing", "cancelled"], preparing: ["ready", "cancelled"], ready: ["handed_over"], handed_over: [], cancelled: [] };
  if (!transitions[from]?.includes(to)) throw new ApiError("订单当前状态不支持此操作，请刷新后重试", 409);
  if (to === "cancelled" && (typeof cancelReason !== "string" || !cancelReason.trim() || cancelReason.trim().length > 200)) throw new ApiError("取消订单须填写 1–200 字原因");
}
