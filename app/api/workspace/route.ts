import { authorize, database, failure, result, settingsFor } from "../../../lib/server";
import { parseDateRange, parseMode, shanghaiDate } from "../../../lib/domain";
import type { Order } from "../../../lib/domain";

export async function GET(request: Request) {
  try {
    const user = await authorize(request);
    const url = new URL(request.url);
    const mode = parseMode(url.searchParams.get("mode") ?? "demo");
    const date = url.searchParams.get("date") ?? shanghaiDate();
    const { start, end } = parseDateRange(date);
    const [rows, activeRows, settings] = await Promise.all([
      database().prepare("SELECT document FROM orders WHERE owner_id = ? AND is_demo = ? AND created_at >= ? AND created_at < ? ORDER BY created_at DESC LIMIT 2001").bind(user.userId, mode === "demo" ? 1 : 0, start, end).all<{ document: string }>(),
      database().prepare("SELECT document FROM orders WHERE owner_id = ? AND is_demo = ? AND status IN ('new', 'preparing', 'ready') ORDER BY created_at ASC, id ASC LIMIT 2001").bind(user.userId, mode === "demo" ? 1 : 0).all<{ document: string }>(),
      settingsFor(user.userId),
    ]);
    const orders = rows.results.slice(0, 2000).map((row) => JSON.parse(row.document) as Order);
    const activeOrders = activeRows.results.slice(0, 2000).map((row) => JSON.parse(row.document) as Order);
    return result({ orders, activeOrders, settings, date, truncated: rows.results.length > 2000, activeTruncated: activeRows.results.length > 2000, integration: { connected: false, label: "美团尚未接入", description: "当前支持演示、手工录单和规范 JSON 导入；店内状态不会自动回传美团。" } });
  } catch (error) { return failure(error); }
}
