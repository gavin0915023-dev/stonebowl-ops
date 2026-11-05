import test from "node:test";
import assert from "node:assert/strict";
import {
  ApiError,
  assertTransition,
  calculateTotal,
  parseDateRange,
  parseMode,
  parseNewOrder,
  parseSettings,
  shanghaiDate,
  validateImport,
} from "../lib/domain.ts";

function order(overrides = {}) {
  return {
    externalId: "MT-TEST-0001",
    channel: "meituan-import",
    customerName: "演示顾客",
    deliveryType: "delivery",
    note: "少辣，不放香菜",
    prepMinutes: 15,
    items: [
      {
        name: "牛肉石锅拌饭",
        spec: "标准份",
        quantity: 2,
        unitPriceCents: 2590,
      },
    ],
    ...overrides,
  };
}

test("状态机：仅允许接单、完成出餐、确认交接的顺序", () => {
  for (const [from, to] of [
    ["new", "preparing"],
    ["preparing", "ready"],
    ["ready", "handed_over"],
  ]) {
    assert.doesNotThrow(() => assertTransition(from, to));
  }
  for (const [from, to] of [
    ["new", "ready"],
    ["new", "handed_over"],
    ["preparing", "handed_over"],
    ["ready", "new"],
    ["ready", "preparing"],
    ["new", "new"],
    ["preparing", "preparing"],
  ]) {
    assert.throws(() => assertTransition(from, to), `${from} -> ${to}`);
  }
});

test("状态机：取消必须有原因，终态不可继续流转", () => {
  for (const from of ["new", "preparing"]) {
    assert.doesNotThrow(() => assertTransition(from, "cancelled", "顾客申请取消"));
    assert.throws(() => assertTransition(from, "cancelled"));
    assert.throws(() => assertTransition(from, "cancelled", "   "));
  }
  assert.throws(() => assertTransition("ready", "cancelled", "不允许取消已出餐订单"));
  for (const from of ["handed_over", "cancelled"]) {
    for (const to of ["new", "preparing", "ready", "handed_over", "cancelled"]) {
      assert.throws(() => assertTransition(from, to, "测试终态保护"), `${from} -> ${to}`);
    }
  }
  assert.throws(() => assertTransition("unknown", "preparing"));
  assert.throws(() => assertTransition("new", "unknown"));
});

test("金额：以整数分求和，保持菜品数量", () => {
  const result = parseNewOrder(order(), true);
  assert.equal(result.items[0].quantity, 2);
  assert.equal(result.items[0].unitPriceCents, 2590);
  assert.equal(calculateTotal(result.items), 5180);
  assert.equal(calculateTotal([
    ...result.items,
    { name: "米饭加量", spec: "一份", quantity: 3, unitPriceCents: 199 },
  ]), 5777);
});

test("金额与数量：拒绝小数、负数、非数字与不安全整数", () => {
  for (const quantity of [0, -1, 1.5, "2", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseNewOrder(order({
      items: [{ ...order().items[0], quantity }],
    }), true), `quantity=${String(quantity)}`);
  }
  for (const unitPriceCents of [-1, 25.9, "2590", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseNewOrder(order({
      items: [{ ...order().items[0], unitPriceCents }],
    }), true), `unitPriceCents=${String(unitPriceCents)}`);
  }
});

test("金额：单价、数量和订单总额受限，免费加料价格可为零", () => {
  const free = parseNewOrder(order({
    items: [{ name: "免费加葱", spec: "", quantity: 1, unitPriceCents: 0 }],
  }), true);
  assert.equal(calculateTotal(free.items), 0);
  assert.throws(() => calculateTotal([
    { name: "餐品一", spec: "", quantity: 99, unitPriceCents: 1000000 },
    { name: "餐品二", spec: "", quantity: 99, unitPriceCents: 1000000 },
  ]));
  assert.throws(() => parseNewOrder(order({
    items: Array.from({ length: 41 }, () => order().items[0]),
  }), true));
});

test("订单校验：空菜品、空菜名、无外部单号、错误枚举均不可入库", () => {
  assert.throws(() => parseNewOrder(null, true));
  assert.throws(() => parseNewOrder("not-an-order", true));
  assert.throws(() => parseNewOrder(order({ items: [] }), true));
  assert.throws(() => parseNewOrder(order({ items: [{ ...order().items[0], name: "   " }] }), true));
  assert.throws(() => parseNewOrder(order({ externalId: "   " }), true));
  assert.throws(() => parseNewOrder(order({ channel: "untrusted-platform" }), true));
  assert.throws(() => parseNewOrder(order({ deliveryType: "unknown" }), true));
  assert.throws(() => parseNewOrder(order({ prepMinutes: -1 }), true));
  const manual = order({ channel: "manual" });
  delete manual.externalId;
  assert.doesNotThrow(() => parseNewOrder(manual));
});

test("信任边界：导入不得设置状态、服务器时间或额外菜品字段", () => {
  for (const extra of [
    { status: "handed_over" },
    { createdAt: 1 },
    { dueAt: 1 },
    { amountCents: 1 },
  ]) {
    assert.throws(() => parseNewOrder(order(extra), true));
  }
  assert.throws(() => parseNewOrder(order({
    items: [{ ...order().items[0], amountCents: 1 }],
  }), true));
  assert.throws(() => validateImport({ mode: "demo", orders: [order()], userId: "other-user" }));
});

test("隔离：只接受明确的demo/live模式", () => {
  assert.equal(parseMode("demo"), "demo");
  assert.equal(parseMode("live"), "live");
  for (const mode of [null, undefined, "", "DEMO", "production", {}, true]) {
    assert.throws(() => parseMode(mode), `mode=${String(mode)}`);
  }
});

test("导入：验证整个批次，保留外部单号供数据库幂等判定", () => {
  const parsed = validateImport({ mode: "live", orders: [order()] });
  assert.equal(parsed.mode, "live");
  assert.equal(parsed.orders.length, 1);
  assert.equal(parsed.orders[0].externalId, "MT-TEST-0001");
  const duplicate = validateImport({ mode: "demo", orders: [order(), order()] });
  assert.equal(duplicate.orders.length, 2);
  assert.throws(() => validateImport({ mode: "demo", orders: [order(), order({ items: [] })] }));
  assert.throws(() => validateImport({ mode: "demo", orders: Array.from({ length: 101 }, () => order()) }));
  assert.throws(() => validateImport({ mode: "live", orders: [] }));
  assert.throws(() => validateImport({ mode: "other", orders: [order()] }));
  assert.throws(() => validateImport({ mode: "live", orders: "not-an-array" }));
});

test("营业日：使用上海时区午夜，结束时间为下日午夜排他边界", () => {
  const { start, end } = parseDateRange("2026-11-05");
  assert.equal(start, Date.parse("2026-11-05T00:00:00+08:00"));
  assert.equal(end, Date.parse("2026-11-06T00:00:00+08:00"));
  assert.equal(end - start, 24 * 60 * 60 * 1000);
  assert.equal(shanghaiDate(Date.parse("2026-11-04T15:59:59.999Z")), "2026-11-04");
  assert.equal(shanghaiDate(Date.parse("2026-11-04T16:00:00.000Z")), "2026-11-05");
  assert.equal(shanghaiDate(start), "2026-11-05");
  assert.equal(shanghaiDate(end - 1), "2026-11-05");
  assert.equal(shanghaiDate(end), "2026-11-06");
});

test("营业日：拒绝无效公历日期，接受闰年2月29日", () => {
  for (const date of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-11-00", "2026-1-5", "invalid"]) {
    assert.throws(() => parseDateRange(date), date);
  }
  const leap = parseDateRange("2028-02-29");
  assert.equal(leap.start, Date.parse("2028-02-29T00:00:00+08:00"));
  assert.throws(() => shanghaiDate(NaN));
  assert.throws(() => shanghaiDate(Infinity));
});

test("门店设置：名称与制作时间有效，拒绝越界或额外字段", () => {
  assert.deepEqual(parseSettings({ storeName: " 石锅小馆 ", prepMinutes: 15 }), {
    storeName: "石锅小馆",
    prepMinutes: 15,
  });
  assert.throws(() => parseSettings({ storeName: "   ", prepMinutes: 15 }));
  for (const prepMinutes of [0, 2, 121, 15.5, "15"]) {
    assert.throws(() => parseSettings({ storeName: "石锅小馆", prepMinutes }));
  }
  assert.throws(() => parseSettings({ storeName: "石锅小馆", prepMinutes: 15, userId: "other-user" }));
});

test("接口错误语义：输入问题为400，过时或非法状态流转为409", () => {
  assert.throws(() => parseMode("invalid"), (error) => error instanceof ApiError && error.status === 400);
  assert.throws(() => assertTransition("handed_over", "new"), (error) => error instanceof ApiError && error.status === 409);
});
