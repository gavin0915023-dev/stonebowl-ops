import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const enabled = process.env.RUN_API_INTEGRATION_TESTS === "1";
const origin = process.env.API_ORIGIN ?? "http://localhost:8080";

test("built application: authenticated demo ordering, kitchen transitions, imports and visitor isolation", { skip: !enabled, timeout: 120000 }, async (t) => {
  const enter = async () => {
    const response = await fetch(`${origin}/container/session`, { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body: "consent=demo", redirect: "manual" });
    assert.equal(response.status, 303);
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    return cookie;
  };
  const visitorA = await enter();
  const visitorB = await enter();
  const request = async (path, { method = "GET", body, cookie = visitorA } = {}) => {
    const headers = { cookie };
    if (method !== "GET") { headers.origin = origin; headers["content-type"] = "application/json"; }
    const response = await fetch(`${origin}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const value = await response.json();
    return { status: response.status, value };
  };
  const workspace = async (cookie = visitorA) => {
    const response = await request("/api/workspace?mode=demo", { cookie });
    assert.equal(response.status, 200, JSON.stringify(response.value));
    return response.value;
  };
  const input = (extra = {}) => ({ mode: "demo", channel: "manual", customerName: "集成测试虚构顾客", deliveryType: "pickup", note: "仅自动验收使用的虚构数据", items: [{ name: "集成测试招牌部队锅", spec: "单人锅 · 微辣（演示）", quantity: 1, unitPriceCents: 3290 }], ...extra });
  const update = (order, nextStatus, extra = {}) => request(`/api/orders/${order.id}`, { method: "PATCH", body: { expectedVersion: order.version, nextStatus, ...extra } });

  await t.test("authenticated HTML returns 200 with Chinese page title", async () => {
    const response = await fetch(origin, { headers: { cookie: visitorA }, redirect: "manual" });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /<title[^>]*>[^<]*石小满/u);
    assert.doesNotMatch(html, /进入我的演示空间 →/u);
  });

  await t.test("seed 8 once; demo orders include signature hotpot and never claim Meituan connected", async () => {
    const seeded = await request("/api/demo", { method: "POST", body: {} });
    assert.equal(seeded.status, 200, JSON.stringify(seeded.value));
    assert.equal(seeded.value.created, 8);
    assert.equal((await request("/api/demo", { method: "POST", body: {} })).value.created, 0);
    const data = await workspace();
    assert.equal(data.orders.length, 8);
    assert.equal(data.integration.connected, false);
    assert.equal(data.activeOrders.length, 7);
    assert.ok(data.orders.every((order) => order.isDemo));
    assert.equal(data.orders.filter((order) => order.items.some((item) => item.name === "招牌部队锅")).length, 2);
  });

  await t.test("public demo rejects live reads/writes and forged cross-origin writes", async () => {
    assert.equal((await request("/api/workspace?mode=live")).status, 403);
    assert.equal((await request("/api/orders", { method: "POST", body: input({ mode: "live" }) })).status, 403);
    const response = await fetch(`${origin}/api/demo`, { method: "POST", headers: { cookie: visitorA, origin: "https://invalid.test", "content-type": "application/json" }, body: "{}" });
    assert.equal(response.status, 403);
  });

  await t.test("new order moves through preparing, ready and handed_over with audit and correct cents", async () => {
    const created = await request("/api/orders", { method: "POST", body: input() });
    assert.equal(created.status, 201, JSON.stringify(created.value));
    let order = created.value.order;
    assert.equal(order.amountCents, 3290);
    assert.equal(order.status, "new");
    for (const nextStatus of ["preparing", "ready", "handed_over"]) {
      const response = await update(order, nextStatus);
      assert.equal(response.status, 200, JSON.stringify(response.value));
      assert.equal(response.value.order.version, order.version + 1);
      order = response.value.order;
      assert.equal(order.status, nextStatus);
    }
    assert.equal(order.events.length, 4);
    assert.deepEqual(order.events.map((event) => event.status), ["new", "preparing", "ready", "handed_over"]);
    assert.ok(!(await workspace()).activeOrders.some((active) => active.id === order.id));
  });

  await t.test("skip transitions, missing cancel reason and stale writes are blocked", async () => {
    const created = await request("/api/orders", { method: "POST", body: input() });
    const order = created.value.order;
    assert.equal((await update(order, "ready")).status, 409);
    assert.equal((await update(order, "cancelled")).status, 400);
    const accepted = await update(order, "preparing");
    assert.equal(accepted.status, 200);
    assert.equal((await update(order, "preparing")).status, 409);
    const cancelled = await update(accepted.value.order, "cancelled", { cancelReason: "虚构验收订单取消" });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.value.order.status, "cancelled");
    assert.equal(cancelled.value.order.events.at(-1).reason, "虚构验收订单取消");
    assert.equal((await update(cancelled.value.order, "preparing")).status, 409);
    assert.ok(!(await workspace()).activeOrders.some((active) => active.id === order.id));
  });

  await t.test("normalized import is idempotent and an invalid batch writes nothing", async () => {
    const externalId = `fictional-api-test-${randomUUID()}`;
    const importedOrder = input({ externalId, channel: "meituan-import" });
    delete importedOrder.mode;
    const payload = { mode: "demo", orders: [importedOrder] };
    const first = await request("/api/import", { method: "POST", body: payload });
    assert.equal(first.status, 200, JSON.stringify(first.value));
    assert.deepEqual(first.value, { imported: 1, duplicates: 0 });
    const repeated = await request("/api/import", { method: "POST", body: payload });
    assert.equal(repeated.status, 200);
    assert.deepEqual(repeated.value, { imported: 0, duplicates: 1 });
    const before = (await workspace()).orders.length;
    const invalid = await request("/api/import", { method: "POST", body: { mode: "demo", orders: [{ ...importedOrder, externalId: `fictional-must-not-write-${randomUUID()}` }, { ...importedOrder, externalId: "invalid-test", items: [{ name: "不合法演示菜品", spec: "", quantity: 1, unitPriceCents: 0.5 }] }] } });
    assert.equal(invalid.status, 400);
    assert.equal((await workspace()).orders.length, before);
  });

  await t.test("another visitor sees no records and cannot update someone else's order", async () => {
    assert.equal((await workspace(visitorB)).orders.length, 0);
    assert.equal((await workspace(visitorB)).activeOrders.length, 0);
    const owned = (await workspace()).orders[0];
    const response = await request(`/api/orders/${owned.id}`, { method: "PATCH", cookie: visitorB, body: { expectedVersion: owned.version, nextStatus: "preparing" } });
    assert.equal(response.status, 404);
  });
});
