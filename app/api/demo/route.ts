import { authorize, database, demoOrders, failure, insertStatement, readBody, result, settingsFor } from "../../../lib/server";
import { record } from "../../../lib/domain";

export async function POST(request: Request) {
  try {
    const user = await authorize(request, true);
    record(await readBody(request));
    const settings = await settingsFor(user.userId);
    const samples = demoOrders(user.displayName, settings.prepMinutes);
    const writes = await database().batch(samples.map((order) => insertStatement(user.userId, order)));
    return result({ created: writes.reduce((sum, write) => sum + (write.meta.changes ?? 0), 0) });
  } catch (error) { return failure(error); }
}
