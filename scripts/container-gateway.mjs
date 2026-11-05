import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";

export const COOKIE_NAME = "stonebowl_demo_session";
export const SESSION_MS = 8 * 60 * 60 * 1000;
const MAX_BODY = 512 * 1024;
const SAFE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HOP_HEADERS = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);

export function normalizePublicOrigin(value) {
  const origin = new URL(value);
  if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("PUBLIC_ORIGIN must be an http(s) origin without a path.");
  return origin.origin;
}

export function signSession(secret, id = randomUUID(), now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ v: 1, id, issuedAt: now, expiresAt: now + SESSION_MS })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifySession(token, secret, now = Date.now()) {
  if (typeof token !== "string" || token.length > 1000) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/u.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/u.test(parts[1])) return null;
  const expected = createHmac("sha256", secret).update(parts[0]).digest();
  const supplied = Buffer.from(parts[1], "base64url");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (payload.v !== 1 || !SAFE_ID.test(payload.id) || !Number.isSafeInteger(payload.issuedAt) || !Number.isSafeInteger(payload.expiresAt) || payload.issuedAt > now + 30000 || payload.expiresAt <= now || payload.expiresAt - payload.issuedAt !== SESSION_MS) return null;
    return payload;
  } catch { return null; }
}

export function sessionFromCookie(header, secret, now) {
  if (typeof header !== "string" || header.length > 8192) return null;
  const values = header.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (values.length !== 1) return null;
  return verifySession(values[0].slice(COOKIE_NAME.length + 1), secret, now);
}

export function isSameOrigin(headers, publicOrigin) {
  return headers.origin === publicOrigin && headers["sec-fetch-site"] !== "cross-site";
}

export function upstreamHeaders(incoming, session, upstreamOrigin) {
  const result = {};
  const connectionTokens = new Set(String(incoming.connection ?? "").toLowerCase().split(",").map((token) => token.trim()));
  for (const [rawName, value] of Object.entries(incoming)) {
    const name = rawName.toLowerCase();
    if (value === undefined || HOP_HEADERS.has(name) || connectionTokens.has(name) || ["host", "cookie", "authorization", "content-length", "origin", "forwarded"].includes(name) || name.startsWith("oai-") || name.startsWith("x-forwarded-") || name.startsWith("proxy-")) continue;
    result[name] = value;
  }
  result.host = new URL(upstreamOrigin).host;
  if (incoming.origin) result.origin = upstreamOrigin;
  result["oai-authenticated-user-id"] = `container-demo-${session.id}`;
  result["oai-authenticated-user-email"] = `demo-${session.id}@container.invalid`;
  result["oai-authenticated-user-full-name"] = encodeURIComponent("公开演示访客");
  result["oai-authenticated-user-full-name-encoding"] = "percent-encoded-utf-8";
  return result;
}

export function validateDemoApi(method, url, body) {
  const path = url.pathname;
  if (method === "GET" && path === "/api/workspace") {
    const modes = url.searchParams.getAll("mode");
    if (modes.length > 1 || (modes.length === 1 && modes[0] !== "demo")) throw new Error("公开演示只允许演示模式，不接收真实营业数据。");
    url.searchParams.set("mode", "demo");
    return;
  }
  if (method === "POST" && ["/api/orders", "/api/import"].includes(path)) {
    let payload;
    try { payload = JSON.parse(body.toString("utf8")); } catch { throw new Error("请求须为有效 JSON。"); }
    if (!payload || Array.isArray(payload) || payload.mode !== "demo") throw new Error("公开演示只允许演示模式，不接收真实营业数据。");
    return;
  }
  if ((method === "POST" && path === "/api/demo") || (method === "PUT" && path === "/api/settings") || (method === "PATCH" && /^\/api\/orders\/[0-9a-f-]{36}$/u.test(path))) return;
  throw new Error("公开演示不支持此接口。");
}

export function createRateLimiter({ limit = 120, windowMs = 60000, capacity = 5000 } = {}) {
  const entries = new Map();
  return (key, now = Date.now()) => {
    let entry = entries.get(key);
    if (entry && now >= entry.resetAt) { entries.delete(key); entry = undefined; }
    if (!entry) {
      if (entries.size >= capacity) {
        for (const [candidate, value] of entries) if (value.resetAt <= now) entries.delete(candidate);
        if (entries.size >= capacity) return false;
      }
      entry = { count: 0, resetAt: now + windowMs };
      entries.set(key, entry);
    }
    entry.count += 1;
    return entry.count <= limit;
  };
}

function reply(res, status, value) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

function sessionCookie(token, origin, expired = false) {
  return `${COOKIE_NAME}=${expired ? "" : token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${expired ? 0 : SESSION_MS / 1000}${origin.startsWith("https:") ? "; Secure" : ""}`;
}

function landingPage(logout = false) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>石小满 · 公开演示</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f4f1eb;color:#282d2a;font:16px/1.8 system-ui,"Microsoft YaHei",sans-serif}main{width:100%;max-width:510px;background:#fff;border:1px solid #e5e0d8;border-radius:24px;padding:38px;box-shadow:0 20px 70px #2b24100a}small{color:#a94b2c;letter-spacing:.1em}h1{font-size:30px;line-height:1.4;margin:16px 0}p{color:#686c65}.notice{padding:15px 18px;background:#fff5df;border-radius:12px;color:#715d2d;font-size:14px}button{width:100%;margin-top:24px;padding:14px;border:0;border-radius:10px;background:#b94f31;color:white;font:inherit;font-weight:600;cursor:pointer}a{color:#765c45;font-size:14px}footer{margin-top:18px;color:#9a9c94;font-size:12px}</style><main><small>STONEBOWL / DEMO</small><h1>${logout ? "退出本次演示？" : "欢迎体验<br>石小满门店工作台"}</h1><p>${logout ? "退出会结束当前浏览器的演示会话。" : "体验接单、部队锅与石锅拌饭出餐，以及厨房看板的完整流程。"}</p><div class="notice">这是公开演示，仅用于虚构数据。每个访客拥有独立的演示空间，不能接入真实美团订单，也不能用于门店正式营业。请勿录入真实顾客信息。菜单与价格均为示例。</div><form method="post" action="${logout ? "/container/logout" : "/container/session"}"><input type="hidden" name="consent" value="demo"><button>${logout ? "退出演示" : "进入我的演示空间 →"}</button></form>${logout ? '<a href="/">返回工作台</a>' : ""}<footer>演示会话有效期 8 小时 · Cookie 仅用于当前访客身份</footer></main></html>`;
}

async function readBody(req, maximum = MAX_BODY) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > maximum) throw new Error("请求内容过大。");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length);
}

export function createGateway({ secret, publicOrigin = "http://localhost:8080", upstreamOrigin = "http://127.0.0.1:8787", isReady = () => true, onError = () => {} }) {
  if (!Buffer.isBuffer(secret) || secret.length < 32) throw new Error("The session signing secret must contain at least 32 random bytes.");
  publicOrigin = normalizePublicOrigin(publicOrigin);
  const expectedHost = new URL(publicOrigin).host.toLowerCase();
  const limits = createRateLimiter();
  const sessionLimits = createRateLimiter({ limit: 15, windowMs: 10 * 60000 });
  const revoked = new Map();

  return createServer(async (req, res) => {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "same-origin");
    res.setHeader("x-frame-options", "SAMEORIGIN");
    res.setHeader("cache-control", "no-store");
    try {
      if (!req.url?.startsWith("/") || req.url.startsWith("//")) return reply(res, 400, { error: "请求路径无效。" });
      const url = new URL(req.url ?? "/", publicOrigin);
      if (url.pathname === "/healthz" && req.method === "GET") return reply(res, isReady() ? 200 : 503, { status: isReady() ? "ready" : "starting", mode: "public-demo" });
      if ((req.headers.host ?? "").toLowerCase() !== expectedHost || url.origin !== publicOrigin) return reply(res, 421, { error: "请求域名与 PUBLIC_ORIGIN 不一致。" });
      if (req.url?.includes("\\") || url.pathname.includes("%") || url.pathname.includes("//")) return reply(res, 400, { error: "请求路径无效。" });
      const key = req.socket.remoteAddress ?? "unknown";
      if (!limits(key)) { res.setHeader("retry-after", "60"); return reply(res, 429, { error: "演示请求过于频繁，请稍后再试。" }); }
      for (const [id, expiresAt] of revoked) if (expiresAt <= Date.now()) revoked.delete(id);
      let session = sessionFromCookie(req.headers.cookie, secret);
      if (session && revoked.has(session.id)) session = null;
      const mutation = !["GET", "HEAD"].includes(req.method ?? "GET");
      if (mutation && !isSameOrigin(req.headers, publicOrigin)) return reply(res, 403, { error: "请从当前演示页面提交操作。" });

      if (url.pathname === "/container/session" && req.method === "GET") return reply(res, 200, { mode: "demo", publicDemo: true, authenticated: !!session });
      if (url.pathname === "/container/session" && req.method === "POST") {
        if (!sessionLimits(key)) return reply(res, 429, { error: "创建演示空间过于频繁，请稍后再试。" });
        const body = await readBody(req, 4096);
        if (req.headers["content-type"]?.split(";")[0] !== "application/x-www-form-urlencoded" || new URLSearchParams(body.toString("utf8")).get("consent") !== "demo") return reply(res, 400, { error: "请先阅读并确认演示说明。" });
        const token = signSession(secret);
        res.writeHead(303, { location: "/", "set-cookie": sessionCookie(token, publicOrigin) });
        return res.end();
      }
      if (url.pathname === "/container/logout" && req.method === "POST") {
        if (session) revoked.set(session.id, session.expiresAt);
        res.writeHead(303, { location: "/", "set-cookie": sessionCookie("", publicOrigin, true) });
        return res.end();
      }
      if (url.pathname === "/signout-with-chatgpt" && req.method === "GET") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(landingPage(true));
      }
      if (!session || url.pathname === "/signin-with-chatgpt") {
        if (url.pathname.startsWith("/api/")) return reply(res, 401, { error: "请先进入演示空间。" });
        if (req.method !== "GET" && req.method !== "HEAD") return reply(res, 401, { error: "请先进入演示空间。" });
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(req.method === "HEAD" ? "" : landingPage());
      }
      if (!isReady()) return reply(res, 503, { error: "演示服务正在启动，请稍后刷新。" });
      const body = mutation ? await readBody(req) : Buffer.alloc(0);
      if (url.pathname.startsWith("/api/")) {
        try { validateDemoApi(req.method, url, body); }
        catch (error) { return reply(res, 403, { error: error.message }); }
      } else if (mutation) {
        return reply(res, 405, { error: "仅允许通过演示接口提交数据。" });
      }
      const headers = upstreamHeaders(req.headers, session, upstreamOrigin);
      if (body.length) headers["content-length"] = String(body.length);
      const proxy = httpRequest(new URL(`${url.pathname}${url.search}`, upstreamOrigin), { method: req.method, headers, timeout: 30000 }, (upstream) => {
        const output = {};
        for (const [name, value] of Object.entries(upstream.headers)) if (!HOP_HEADERS.has(name) && name !== "set-cookie" && name !== "content-length" && value !== undefined) output[name] = value;
        if (output.location?.startsWith(upstreamOrigin)) output.location = publicOrigin + output.location.slice(upstreamOrigin.length);
        output["cache-control"] = "no-store";
        res.writeHead(upstream.statusCode ?? 502, output);
        upstream.on("error", (error) => { onError(error); res.destroy(); });
        upstream.pipe(res);
      });
      proxy.on("timeout", () => proxy.destroy(new Error("Upstream timeout")));
      proxy.on("error", (error) => { onError(error); if (!res.headersSent) reply(res, 502, { error: "演示服务暂时不可用，请稍后重试。" }); else res.destroy(); });
      req.on("aborted", () => proxy.destroy());
      res.on("close", () => proxy.destroy());
      proxy.end(body);
    } catch (error) {
      onError(error);
      if (!res.headersSent) reply(res, 400, { error: "请求无法处理，请检查内容后重试。" });
      else res.destroy();
    }
  });
}
