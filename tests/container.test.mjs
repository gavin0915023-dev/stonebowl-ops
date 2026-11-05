import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { COOKIE_NAME, SESSION_MS, createGateway, createRateLimiter, isSameOrigin, normalizePublicOrigin, sessionFromCookie, signSession, upstreamHeaders, validateDemoApi, verifySession } from "../scripts/container-gateway.mjs";
import { migrationName, validateMigrationHistory } from "../scripts/container-migrations.mjs";

const secret = randomBytes(48);
test("signed sessions reject tampering, wrong keys, expiry and malformed cookies", () => {
  const id = randomUUID();
  const now = 1_800_000_000_000;
  const token = signSession(secret, id, now);
  assert.equal(verifySession(token, secret, now).id, id);
  assert.equal(verifySession(token, randomBytes(48), now), null);
  assert.equal(verifySession(`${token.slice(0, -1)}!`, secret, now), null);
  assert.equal(verifySession(token, secret, now + SESSION_MS), null);
  assert.equal(verifySession(token, secret, now - 31000), null);
  assert.equal(sessionFromCookie(`${COOKIE_NAME}=${token}`, secret, now).id, id);
  assert.equal(sessionFromCookie(`${COOKIE_NAME}=${token}; ${COOKIE_NAME}=${token}`, secret, now), null);
});

test("proxy identity cannot be supplied by clients", () => {
  const id = randomUUID();
  const result = upstreamHeaders({ host: "attacker.test", authorization: "Bearer fake", cookie: "fake", "oai-authenticated-user-id": "owner", "x-forwarded-host": "attacker.test", forwarded: "for=attacker", connection: "x-poison", "x-poison": "bad", origin: "https://demo.test", accept: "application/json" }, { id }, "http://127.0.0.1:8787");
  assert.equal(result["oai-authenticated-user-id"], `container-demo-${id}`);
  assert.equal(result.origin, "http://127.0.0.1:8787");
  assert.equal(result.host, "127.0.0.1:8787");
  for (const name of ["authorization", "cookie", "x-forwarded-host", "forwarded", "x-poison"]) assert.equal(result[name], undefined);
});

test("demo API gate rejects live mode, duplicate query mode, unknown APIs and server actions", () => {
  const body = Buffer.from('{"mode":"demo"}');
  const url = new URL("https://demo.test/api/workspace");
  validateDemoApi("GET", url, Buffer.alloc(0));
  assert.equal(url.searchParams.get("mode"), "demo");
  assert.throws(() => validateDemoApi("GET", new URL("https://demo.test/api/workspace?mode=live"), body));
  assert.throws(() => validateDemoApi("GET", new URL("https://demo.test/api/workspace?mode=demo&mode=live"), body));
  assert.doesNotThrow(() => validateDemoApi("POST", new URL("https://demo.test/api/orders"), body));
  assert.throws(() => validateDemoApi("POST", new URL("https://demo.test/api/orders"), Buffer.from('{"mode":"live"}')));
  assert.throws(() => validateDemoApi("POST", new URL("https://demo.test/api/unknown"), body));
  assert.throws(() => validateDemoApi("DELETE", new URL("https://demo.test/api/orders"), body));
});

test("origin validation and bounded rate limiter", () => {
  assert.equal(normalizePublicOrigin("https://demo.test/"), "https://demo.test");
  assert.throws(() => normalizePublicOrigin("https://user:pass@demo.test"));
  assert.throws(() => normalizePublicOrigin("https://demo.test/subpath"));
  assert.equal(isSameOrigin({ origin: "https://demo.test" }, "https://demo.test"), true);
  assert.equal(isSameOrigin({ origin: "https://evil.test" }, "https://demo.test"), false);
  assert.equal(isSameOrigin({ origin: "https://demo.test", "sec-fetch-site": "cross-site" }, "https://demo.test"), false);
  const allow = createRateLimiter({ limit: 2, windowMs: 100, capacity: 1 });
  assert.equal(allow("a", 0), true);
  assert.equal(allow("a", 1), true);
  assert.equal(allow("a", 2), false);
  assert.equal(allow("b", 3), false);
  assert.equal(allow("b", 101), true);
});

test("migration names carry hashes; changed, removed or reordered applied SQL is refused", () => {
  const first = migrationName("0000_init", "CREATE TABLE test (id TEXT);");
  const changed = migrationName("0000_init", "CREATE TABLE test (id INTEGER);");
  const next = migrationName("0001_next", "ALTER TABLE test ADD COLUMN name TEXT;");
  assert.notEqual(first, changed);
  assert.match(first, /^0000_init__[a-f0-9]{64}\.sql$/u);
  assert.throws(() => migrationName("../../escape", "SELECT 1"));
  assert.doesNotThrow(() => validateMigrationHistory([first, next], []));
  assert.doesNotThrow(() => validateMigrationHistory([first, next], [first]));
  assert.throws(() => validateMigrationHistory([changed, next], [first]));
  assert.throws(() => validateMigrationHistory([next], [first]));
  assert.throws(() => validateMigrationHistory([next, first], [first]));
});

test("gateway isolates visitors, strips forged owner, rejects live writes, and revokes logout", async (t) => {
  const observed = [];
  const upstream = createServer((req, res) => { observed.push(req.headers); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true })); });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => { upstream.close(); upstream.closeAllConnections(); });
  const upstreamOrigin = `http://127.0.0.1:${upstream.address().port}`;
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const gateway = createGateway({ secret, publicOrigin: origin, upstreamOrigin });
  await new Promise((resolve) => gateway.listen(port, "127.0.0.1", resolve));
  t.after(() => { gateway.close(); gateway.closeAllConnections(); });
  const landing = await fetch(origin);
  assert.match(await landing.text(), /公开演示/u);
  const enter = async () => {
    const response = await fetch(`${origin}/container/session`, { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body: "consent=demo", redirect: "manual" });
    assert.equal(response.status, 303);
    assert.match(response.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/u);
    return response.headers.get("set-cookie").split(";")[0];
  };
  const visitorA = await enter();
  const visitorB = await enter();
  assert.notEqual(visitorA, visitorB);
  await fetch(`${origin}/api/workspace?mode=demo`, { headers: { cookie: visitorA, "oai-authenticated-user-id": "forged-owner" } });
  await fetch(`${origin}/api/workspace?mode=demo`, { headers: { cookie: visitorB } });
  assert.notEqual(observed[0]["oai-authenticated-user-id"], observed[1]["oai-authenticated-user-id"]);
  assert.notEqual(observed[0]["oai-authenticated-user-id"], "forged-owner");
  const before = observed.length;
  assert.equal((await fetch(`${origin}/api/workspace?mode=live`, { headers: { cookie: visitorA } })).status, 403);
  assert.equal((await fetch(`${origin}/api/orders`, { method: "POST", headers: { cookie: visitorA, origin, "content-type": "application/json" }, body: '{"mode":"live"}' })).status, 403);
  assert.equal((await fetch(`${origin}/api/demo`, { method: "POST", headers: { cookie: visitorA, origin: "https://evil.test", "content-type": "application/json" }, body: "{}" })).status, 403);
  assert.equal(observed.length, before);
  assert.equal((await fetch(`${origin}/%61pi/workspace?mode=live`, { headers: { cookie: visitorA } })).status, 400);
  const rawRequest = (requestPath, host) => new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, path: requestPath, headers: { host, cookie: visitorA } }, (response) => { response.resume(); response.on("end", () => resolve(response.statusCode)); });
    request.on("error", reject); request.end();
  });
  assert.equal(await rawRequest("http://evil.test/api/workspace?mode=live", new URL(origin).host), 400);
  assert.equal(await rawRequest("/api/workspace?mode=demo", "evil.test"), 421);
  const secureProbe = createServer();
  await new Promise((resolve) => secureProbe.listen(0, "127.0.0.1", resolve));
  const securePort = secureProbe.address().port;
  await new Promise((resolve) => secureProbe.close(resolve));
  const secureOrigin = `https://demo.test:${securePort}`;
  const secureGateway = createGateway({ secret, publicOrigin: secureOrigin, upstreamOrigin });
  await new Promise((resolve) => secureGateway.listen(securePort, "127.0.0.1", resolve));
  t.after(() => { secureGateway.close(); secureGateway.closeAllConnections(); });
  const secureCookie = await new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port: securePort, path: "/container/session", method: "POST", headers: { host: new URL(secureOrigin).host, origin: secureOrigin, "content-type": "application/x-www-form-urlencoded" } }, (response) => { response.resume(); response.on("end", () => resolve(response.headers["set-cookie"][0])); });
    request.on("error", reject); request.end("consent=demo");
  });
  assert.match(secureCookie, /; Secure$/u);
  const logout = await fetch(`${origin}/container/logout`, { method: "POST", headers: { cookie: visitorA, origin }, redirect: "manual" });
  assert.equal(logout.status, 303);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/u);
  assert.equal((await fetch(`${origin}/api/workspace?mode=demo`, { headers: { cookie: visitorA } })).status, 401);
});
