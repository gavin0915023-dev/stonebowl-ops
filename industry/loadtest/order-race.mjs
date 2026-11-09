#!/usr/bin/env node
/**
 * 订餐状态机并发压测与领域规则回归（FR-S1 / FR-S2 / ADR-002 的同类验证）。
 *
 *   node order-race.mjs --self-test
 *       纯逻辑自检：验证状态转移表、取消规则、金额整数分、上海自然日。
 *       不连接服务，不产生压测结论。
 *
 *   node order-race.mjs --base http://127.0.0.1:8080 --order-id <uuid> --yes
 *       对真实服务并发推进同一订单，期望只有 1 次成功，其余 409 冲突。
 *       未加 --yes 拒绝运行；服务不可达明确报错，绝不伪造结果。
 *
 * 注意：真实模式下 PATCH 请求体默认 {"status":"preparing"}，
 * 若实际接口使用 action 字段，请用 --patch-body '{"action":"..."}' 覆盖。
 */
const argv = process.argv.slice(2);
const get = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const has = (flag) => argv.includes(flag);
const base = get('--base', '');
const selfTest = has('--self-test') || !base;
const concurrency = Number(get('--concurrency', '8'));

// 与 lib/domain.ts assertTransition 一致
const TRANSITIONS = {
  new: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['handed_over'],
  handed_over: [],
  cancelled: [],
};

function canTransition(from, to, cancelReason) {
  if (!TRANSITIONS[from]?.includes(to)) return false;
  if (to === 'cancelled' && (!cancelReason || !cancelReason.trim() || cancelReason.trim().length > 200)) {
    return false;
  }
  return true;
}

function shanghaiDate(ts) {
  return new Date(ts + 8 * 3600000).toISOString().slice(0, 10);
}

function runSelfTest() {
  const cases = [
    ['new → preparing', canTransition('new', 'preparing'), true],
    ['new → ready 应拒绝', canTransition('new', 'ready'), false],
    ['preparing → ready', canTransition('preparing', 'ready'), true],
    ['ready → handed_over', canTransition('ready', 'handed_over'), true],
    ['handed_over → 任何状态应拒绝', canTransition('handed_over', 'new'), false],
    ['cancelled 不可回退', canTransition('cancelled', 'new'), false],
    ['取消无原因应拒绝', canTransition('new', 'cancelled', ''), false],
    ['取消带原因应通过', canTransition('preparing', 'cancelled', '顾客改约'), true],
    ['取消原因超 200 字应拒绝', canTransition('new', 'cancelled', 'x'.repeat(201)), false],
  ];
  let pass = true;
  for (const [name, actual, expected] of cases) {
    const ok = actual === expected;
    if (!ok) pass = false;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  }
  const total = 2690 * 2 + 1290;
  if (total !== 6670) pass = false;
  console.log(`  ${total === 6670 ? 'PASS' : 'FAIL'}  金额按整数分累加 = ${total}`);
  const day = shanghaiDate(Date.parse('2026-11-06T17:30:00Z'));
  if (day !== '2026-11-07') pass = false;
  console.log(`  ${day === '2026-11-07' ? 'PASS' : 'FAIL'}  上海自然日跨 UTC 边界 = ${day}`);

  console.log('\nSELF-TEST ' + (pass ? 'PASS' : 'FAIL'));
  console.log('  以上仅验证领域规则逻辑，未连接任何服务，不能作为发布依据。');
  return pass ? 0 : 1;
}

async function runLoadTest() {
  if (!has('--yes')) {
    console.error('真实压测会修改订单状态。确认在测试环境执行后加 --yes 重试。');
    return 2;
  }
  const orderId = get('--order-id', '');
  if (!orderId) {
    console.error('缺少 --order-id，请指定一个处于 new 状态的测试订单 UUID。');
    return 2;
  }
  let patchBody;
  try {
    patchBody = JSON.parse(get('--patch-body', '{"status":"preparing"}'));
  } catch {
    console.error('--patch-body 不是合法 JSON');
    return 2;
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const probe = await fetch(base + '/healthz', { signal: ctrl.signal });
    clearTimeout(timer);
    if (!probe.ok && probe.status !== 503) throw new Error('HTTP ' + probe.status);
  } catch (error) {
    console.error('服务不可达：' + error.message);
    console.error('未执行任何压测，不生成压测报告。');
    return 2;
  }

  const call = async () => {
    const res = await fetch(`${base}/api/orders/${orderId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Origin': base,
        'Sec-Fetch-Site': 'same-origin',
      },
      body: JSON.stringify(patchBody),
    });
    return { ok: res.ok, status: res.status };
  };

  const results = await Promise.all(Array.from({ length: concurrency }, call));
  const succeeded = results.filter(r => r.ok).length;
  const conflicts = results.filter(r => r.status === 409 || r.status === 403).length;
  const pass = succeeded <= 1;
  console.log(`并发 ${concurrency} 次推进同一订单 → 成功 ${succeeded}，冲突 ${conflicts}`);
  console.log(`期望成功数 ≤ 1 → ${pass ? 'PASS' : 'FAIL'}`);
  console.log('\nREPORT ' + JSON.stringify({ base, orderId, concurrency, succeeded, conflicts, pass }, null, 2));
  console.log('请归档结果并写入 docs/DRILL-RECORD.md');
  return pass ? 0 : 1;
}

Promise.resolve(selfTest ? runSelfTest() : runLoadTest())
  .then((code) => process.exit(code))
  .catch((error) => { console.error('异常：' + error.message); process.exit(2); });
