import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrationName } from "./container-migrations.mjs";

export async function validateContainerArtifact(root = process.cwd()) {
  const server = path.join(root, "dist", "server");
  const config = JSON.parse(await readFile(path.join(server, "wrangler.json"), "utf8"));
  if (!config.d1_databases?.some((binding) => binding.binding === "DB")) throw new Error("Container artifact has no DB binding.");
  if (!config.main) throw new Error("Container artifact has no Worker entrypoint.");
  await access(path.resolve(server, config.main));
  if (config.assets?.directory) await access(path.resolve(server, config.assets.directory));
  const journal = JSON.parse(await readFile(path.join(root, "drizzle", "meta", "_journal.json"), "utf8"));
  if (!journal.entries?.length) throw new Error("Generate and commit the initial schema migration before building this image.");
  const names = [];
  for (const entry of journal.entries) {
    migrationName(entry.tag, "");
    const sql = await readFile(path.join(root, "drizzle", `${entry.tag}.sql`), "utf8");
    if (!sql.trim()) throw new Error("Container schema migrations cannot be empty.");
    names.push(migrationName(entry.tag, sql));
  }
  if (new Set(names).size !== names.length || names.some((name, index) => index > 0 && name.localeCompare(names[index - 1]) <= 0)) throw new Error("Invalid migration order.");
  return { migrations: names.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  validateContainerArtifact().then(({ migrations }) => console.log(`Container artifact validated; ${migrations} schema migration(s).`)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
