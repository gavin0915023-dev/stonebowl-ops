import { validateImport } from "../../../lib/domain";
import { authorize, createOrder, database, failure, insertStatement, readBody, result, settingsFor } from "../../../lib/server";

export async function POST(request: Request) {
  try {
    const user = await authorize(request, true);
    const { mode, orders } = validateImport(await readBody(request));
    const settings = await settingsFor(user.userId);
    const normalized = orders.map((input) => createOrder(input, mode, settings.prepMinutes, user.displayName));
    // D1 batch is transactional: a failed statement rolls back the complete import.
    const writes = await database().batch(normalized.map((order) => insertStatement(user.userId, order)));
    const imported = writes.reduce((sum, write) => sum + (write.meta.changes ?? 0), 0);
    return result({ imported, duplicates: orders.length - imported });
  } catch (error) { return failure(error); }
}
