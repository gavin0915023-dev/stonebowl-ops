import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createGateway, normalizePublicOrigin } from "./container-gateway.mjs";
import { prepareContainerMigrations } from "./container-migrations.mjs";

const root = process.cwd();
const stateDirectory = process.env.CONTAINER_STATE_DIRECTORY ? path.resolve(root, process.env.CONTAINER_STATE_DIRECTORY) : path.join(root, ".wrangler", "state");
const publicOrigin = normalizePublicOrigin(process.env.PUBLIC_ORIGIN ?? "http://localhost:8080");
const port = Number(process.env.PORT ?? "8080");
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error("PORT must be an unprivileged TCP port.");
await mkdir(stateDirectory, { recursive: true });
const secretPath = path.join(stateDirectory, "container-session-secret");
let secret;
try { secret = await readFile(secretPath); }
catch (error) {
  if (error.code !== "ENOENT") throw error;
  try { await writeFile(secretPath, randomBytes(48), { flag: "wx", mode: 0o600 }); }
  catch (writeError) { if (writeError.code !== "EEXIST") throw writeError; }
  secret = await readFile(secretPath);
}
if (secret.length < 32) throw new Error("Session secret file is invalid; restore the volume backup.");
console.log("Starting Stonebowl PUBLIC DEMO. Only fictional data is allowed; real Meituan integration is disabled.");
const { configPath } = await prepareContainerMigrations(root, stateDirectory);
const runtime = spawn(process.execPath, ["--import", pathToFileURL(path.join(root, "scripts", "sites-env.mjs")).href, path.join(root, "node_modules", "wrangler", "bin", "wrangler.js"), "dev", "--config", configPath, "--local", "--persist-to", stateDirectory, "--ip", "127.0.0.1", "--port", "8787", "--inspector-port", "0"], { stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false", CLOUDFLARE_CF_FETCH_ENABLED: "false" } });
let ready = false;
let closing = false;
const gateway = createGateway({ secret, publicOrigin, isReady: () => ready, onError: (error) => console.error("Demo gateway:", error.code ?? error.name) });
gateway.requestTimeout = 35000;
gateway.headersTimeout = 10000;
gateway.listen(port, "0.0.0.0", () => console.log(`Public demo gateway: ${publicOrigin}`));
const timer = setInterval(async () => {
  try { const response = await fetch("http://127.0.0.1:8787/", { redirect: "manual", signal: AbortSignal.timeout(2000) }); ready = response.status < 500; await response.body?.cancel(); }
  catch { ready = false; }
}, 2000);
timer.unref();
function shutdown(exitCode = 0) {
  if (closing) return;
  process.exitCode = exitCode;
  closing = true;
  ready = false;
  clearInterval(timer);
  gateway.close();
  gateway.closeAllConnections();
  runtime.kill("SIGTERM");
  setTimeout(() => { runtime.kill("SIGKILL"); process.exit(exitCode); }, 5000).unref();
  runtime.once("exit", () => process.exit(exitCode));
}
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => shutdown(0));
runtime.on("error", (error) => { console.error("Worker startup failed:", error.message); shutdown(1); });
runtime.on("exit", (code) => { if (!closing) { console.error("Worker stopped unexpectedly:", code); shutdown(1); } });
gateway.on("error", (error) => { console.error("Gateway startup failed:", error.message); shutdown(1); });
