import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function migrationName(tag, sql) {
  if (!/^\d{4}_[a-zA-Z0-9_]+$/u.test(tag)) throw new Error("Invalid Drizzle migration tag.");
  return `${tag}__${createHash("sha256").update(sql).digest("hex")}.sql`;
}

export function validateMigrationHistory(current, applied) {
  if (!Array.isArray(applied) || applied.length > current.length || applied.some((name, index) => name !== current[index])) throw new Error("Applied migration history differs from this image. Do not edit, remove, reorder, or roll back applied SQL. Restore a compatible image or append a migration.");
}

function runNode(args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: capture ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"], env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false", CLOUDFLARE_CF_FETCH_ENABLED: "false" } });
    let output = "";
    let errors = "";
    child.stdout?.on("data", (chunk) => { output += chunk; });
    child.stderr?.on("data", (chunk) => { errors += chunk; });
    child.on("error", reject);
    child.on("close", (code, signal) => code === 0 ? resolve(output) : reject(new Error(`Container migration command failed (${code ?? signal}). ${capture ? errors.slice(-2000) : "See preceding output."}`)));
  });
}

export async function prepareContainerMigrations(root = process.cwd(), stateDirectory = path.join(root, ".wrangler", "state")) {
  const sourcePath = path.join(root, "dist", "server", "wrangler.json");
  const config = JSON.parse(await readFile(sourcePath, "utf8"));
  const binding = config.d1_databases?.find((entry) => entry.binding === "DB");
  if (!binding) throw new Error("The build must declare a DB D1 binding.");
  const journal = JSON.parse(await readFile(path.join(root, "drizzle", "meta", "_journal.json"), "utf8"));
  if (!Array.isArray(journal.entries) || journal.entries.length === 0) throw new Error("No schema migration found. Generate and commit the initial Drizzle migration before building the image.");
  await mkdir(path.join(root, ".sites-runtime"), { recursive: true });
  const directory = await mkdtemp(path.join(root, ".sites-runtime", "container-migrations-"));
  await mkdir(stateDirectory, { recursive: true });
  const names = [];
  for (const entry of journal.entries) {
    // Validate before resolving a path; tags are trusted source, not URL input.
    migrationName(entry.tag, "");
    const sql = await readFile(path.join(root, "drizzle", `${entry.tag}.sql`), "utf8");
    const name = migrationName(entry.tag, sql);
    if (names.includes(name)) throw new Error("Duplicate migration in Drizzle journal.");
    names.push(name);
    await writeFile(path.join(directory, name), sql, { mode: 0o600 });
  }
  if (names.some((name, index) => index > 0 && name.localeCompare(names[index - 1]) <= 0)) throw new Error("Migration journal must be in ascending filename order.");
  binding.migrations_dir = directory;
  binding.migrations_table = "_container_migrations";
  // Keep the generated config beside the original so relative Worker/assets paths remain correct.
  const configPath = path.join(root, "dist", "server", "container-wrangler.json");
  await writeFile(configPath, JSON.stringify(config, null, 2));
  const cli = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
  const base = ["--import", pathToFileURL(path.join(root, "scripts", "sites-env.mjs")).href, cli];
  const common = ["--local", "--config", configPath, "--persist-to", stateDirectory];
  await runNode([...base, "d1", "execute", "DB", ...common, "--command", "CREATE TABLE IF NOT EXISTS _container_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);", "--json"], { capture: true });
  const output = await runNode([...base, "d1", "execute", "DB", ...common, "--command", "SELECT name FROM _container_migrations ORDER BY id;", "--json"], { capture: true });
  let rows;
  try { rows = JSON.parse(output).flatMap((entry) => entry.results ?? []); }
  catch { throw new Error("Unable to read the local migration registry; refusing to replay SQL."); }
  validateMigrationHistory(names, rows.map((row) => row.name));
  await runNode([...base, "d1", "migrations", "apply", "DB", ...common]);
  return { configPath, stateDirectory, migrations: names.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareContainerMigrations().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
