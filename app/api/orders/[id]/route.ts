import { ApiError, assertTransition, record } from "../../../../lib/domain";
import type { Order, OrderStatus } from "../../../../lib/domain";
import { authorize, database, failure, readBody, result } from "../../../../lib/server";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await authorize(request, true);
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/u.test(id)) throw new ApiError("订单编号无效");
    const input = record(await readBody(request));
    if (Object.keys(input).some((key) => !["expectedVersion", "nextStatus", "cancelReason"].includes(key))) throw new ApiError("操作包含不支持的字段");
    if (!Number.isSafeInteger(input.expectedVersion) || (input.expectedVersion as number) < 1) throw new ApiError("订单版本无效，请刷新后重试");
    if (typeof input.nextStatus !== "string" || !["new", "preparing", "ready", "handed_over", "cancelled"].includes(input.nextStatus)) throw new ApiError("订单状态无效");
    const row = await database().prepare("SELECT document, version FROM orders WHERE id = ? AND owner_id = ?").bind(id, user.userId).first<{ document: string; version: number }>();
    if (!row) throw new ApiError("订单不存在", 404);
    if (row.version !== input.expectedVersion) throw new ApiError("订单已被其他窗口更新，请刷新后重试", 409);
    const order = JSON.parse(row.document) as Order;
    const nextStatus = input.nextStatus as OrderStatus;
    const cancelReason = typeof input.cancelReason === "string" ? input.cancelReason.trim() : undefined;
    assertTransition(order.status, nextStatus, cancelReason);
    const now = Date.now();
    const updated: Order = { ...order, status: nextStatus, version: order.version + 1, updatedAt: now, events: [...order.events, { status: nextStatus, at: now, actor: user.displayName, ...(nextStatus === "cancelled" ? { reason: cancelReason } : {}) }] };
    const write = await database().prepare("UPDATE orders SET status = ?, version = ?, document = ? WHERE id = ? AND owner_id = ? AND version = ?").bind(updated.status, updated.version, JSON.stringify(updated), id, user.userId, input.expectedVersion).run();
    if (write.meta.changes !== 1) throw new ApiError("订单已更新，请刷新后重试", 409);
    return result({ order: updated });
  } catch (error) { return failure(error); }
}
