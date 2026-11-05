import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { prepareContainerMigrations } from "../scripts/container-migrations.mjs";

test("real local D1 migration startup is idempotent and refuses changed SQL", { skip: process.env.RUN_CONTAINER_RUNTIME_TESTS !== "1", timeout: 120000 }, async () => {
  const project = process.cwd();
  await mkdir(path.join(project, ".sites-runtime"), { recursive: true });
  const root = await mkdtemp(path.join(project, ".sites-runtime", "container-runtime-test-"));
  await mkdir(path.join(root, "dist", "server"), { recursive: true });
  await mkdir(path.join(root, "drizzle", "meta"), { recursive: true });
  await symlink(path.join(project, "node_modules"), path.join(root, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  await symlink(path.join(project, "scripts"), path.join(root, "scripts"), process.platform === "win32" ? "junction" : "dir");
  await writeFile(path.join(root, "dist", "server", "index.js"), "export default {fetch(){return new Response('ok')}}");
  await writeFile(path.join(root, "dist", "server", "wrangler.json"), JSON.stringify({ name: "stonebowl-container-runtime-test", main: "index.js", compatibility_date: "2026-05-15", d1_databases: [{ binding: "DB", database_name: "container-test", database_id: "00000000-0000-4000-8000-000000000000" }] }));
  await writeFile(path.join(root, "drizzle", "meta", "_journal.json"), JSON.stringify({ entries: [{ tag: "0000_fixture" }] }));
  const sqlFile = path.join(root, "drizzle", "0000_fixture.sql");
  await writeFile(sqlFile, "CREATE TABLE fixture_orders (id TEXT PRIMARY KEY);\n");
  const first = await prepareContainerMigrations(root);
  assert.equal(first.migrations, 1);
  // A repeated CREATE TABLE would fail. Success proves the native migration registry skips it.
  const second = await prepareContainerMigrations(root);
  assert.equal(second.migrations, 1);
  const runtimeConfig = JSON.parse(await readFile(second.configPath, "utf8"));
  assert.equal(runtimeConfig.d1_databases[0].migrations_table, "_container_migrations");
  await writeFile(sqlFile, "CREATE TABLE fixture_orders (id INTEGER PRIMARY KEY);\n");
  await assert.rejects(() => prepareContainerMigrations(root), /Applied migration history differs/u);
});
