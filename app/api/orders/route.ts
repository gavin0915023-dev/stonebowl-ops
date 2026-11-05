import { authorize, createOrder, database, failure, insertStatement, readBody, result, settingsFor } from "../../../lib/server";
import { parseMode, parseNewOrder, record } from "../../../lib/domain";
import type { Order } from "../../../lib/domain";

export async function POST(request: Request) {
  try {
    const user = await authorize(request, true);
    const raw = record(await readBody(request));
    const mode = parseMode(raw.mode);
    const input = parseNewOrder(raw);
    const settings = await settingsFor(user.userId);
    const order = createOrder(input, mode, settings.prepMinutes, user.displayName);
    const write = await insertStatement(user.userId, order).run();
    if (write.meta.changes === 0) {
      const existing = await database().prepare("SELECT document FROM orders WHERE owner_id = ? AND is_demo = ? AND channel = ? AND external_id = ?").bind(user.userId, order.isDemo ? 1 : 0, order.channel, order.externalId).first<{ document: string }>();
      return result({ order: existing ? JSON.parse(existing.document) as Order : null, duplicate: true }, 200);
    }
    return result({ order, duplicate: false }, 201);
  } catch (error) { return failure(error); }
}
