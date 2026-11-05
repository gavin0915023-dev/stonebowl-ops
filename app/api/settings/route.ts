import { parseSettings } from "../../../lib/domain";
import { authorize, database, failure, readBody, result } from "../../../lib/server";

export async function PUT(request: Request) {
  try {
    const user = await authorize(request, true);
    const settings = parseSettings(await readBody(request));
    await database().prepare("INSERT INTO store_settings (owner_id, store_name, prep_minutes, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET store_name = excluded.store_name, prep_minutes = excluded.prep_minutes, updated_at = excluded.updated_at").bind(user.userId, settings.storeName, settings.prepMinutes, Date.now()).run();
    return result({ settings });
  } catch (error) { return failure(error); }
}
