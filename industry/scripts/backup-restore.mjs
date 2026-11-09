#!/usr/bin/env node
/**
 * D1 / SQLite 快照备份恢复流程演练（NFR-4 / ADR-003）。
 *
 * 用临时目录模拟 .wrangler/state 下的数据库快照与迁移登记表，
 * 实际走完 备份 → 故障 → 恢复 → 三项一致性校验。
 *
 * 这是流程演练，不是对真实数据库的备份。生产须：
 *   1. 停止写入（项目目前只允许单副本、不要让多容器共享同一卷）
 *   2. 复制 .wrangler/state 整个目录到带时间戳的位置
 *   3. 恢复到独立目录，用同一镜像启动并校验
 *   4. 把结果填进 docs/DRILL-RECORD.md
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = mkdtempSync(join(tmpdir(), 'stonebowl-drill-'));
const state = join(root, '.wrangler', 'state');
const dbFile = join(state, 'orders.sqlite');
const migrationFile = join(state, '_container_migrations.json');
const backupDir = join(root, 'backup');
mkdirSync(state, { recursive: true });
mkdirSync(backupDir, { recursive: true });

// 用 JSON 模拟数据库内容，避免引入 SQLite 依赖；真实演练请复制真实 sqlite 文件。
const snapshot = {
  orders: [
    { id: 'a1', isDemo: true, channel: 'demo', status: 'new', amountCents: 5380 },
    { id: 'a2', isDemo: true, channel: 'demo', status: 'ready', amountCents: 2690 },
    { id: 'b1', isDemo: false, channel: 'manual', status: 'preparing', amountCents: 3290 },
  ],
  settings: { storeName: '石小满 · 石锅拌饭', prepMinutes: 15 },
};
const migrations = { applied: ['0000_legal_aqueduct__abc123.sql'] };

function verify(data, mig, label) {
  const problems = [];
  const demoCount = data.orders.filter(o => o.isDemo).length;
  const liveCount = data.orders.filter(o => !o.isDemo).length;
  if (demoCount !== 2 || liveCount !== 1) problems.push('demo/live 空间隔离被破坏');
  if (data.orders.some(o => !Number.isInteger(o.amountCents) || o.amountCents < 0)) {
    problems.push('金额非整数分或为负');
  }
  if (data.orders.some(o => o.isDemo && o.channel !== 'demo')) {
    problems.push('演示空间出现非 demo 来源');
  }
  if (!Array.isArray(mig.applied) || mig.applied.length !== 1) {
    problems.push('迁移登记表缺失或被篡改');
  }
  console.log(`  ${label}：订单 ${data.orders.length}（demo ${demoCount} / live ${liveCount}），迁移 ${mig.applied?.length ?? 0} 条`);
  problems.forEach(p => console.log('    - ' + p));
  return problems.length === 0;
}

let ok = false;
try {
  writeFileSync(dbFile, JSON.stringify(snapshot));
  writeFileSync(migrationFile, JSON.stringify(migrations));

  // 1. 停写后快照
  copyFileSync(dbFile, join(backupDir, 'orders.sqlite'));
  copyFileSync(migrationFile, join(backupDir, '_container_migrations.json'));
  console.log('1 停写并快照：' + (existsSync(join(backupDir, 'orders.sqlite')) ? 'OK' : 'FAIL'));

  // 2. 模拟故障：数据被截断、迁移登记表丢失
  writeFileSync(dbFile, JSON.stringify({ orders: [], settings: snapshot.settings }));
  writeFileSync(migrationFile, JSON.stringify({ applied: [] }));
  console.log('2 模拟故障：订单丢失 + 迁移登记表被清空');

  // 3. 恢复
  copyFileSync(join(backupDir, 'orders.sqlite'), dbFile);
  copyFileSync(join(backupDir, '_container_migrations.json'), migrationFile);
  const restored = JSON.parse(readFileSync(dbFile, 'utf8'));
  const restoredMig = JSON.parse(readFileSync(migrationFile, 'utf8'));
  console.log('3 从快照恢复：' + (restored.orders.length === 3 ? 'OK' : 'FAIL'));

  // 4. 一致性校验
  console.log('4 恢复后校验：');
  ok = verify(restored, restoredMig, '恢复快照') && restored.orders.length === 3;
} catch (error) {
  console.error('演练异常：' + error.message);
  ok = false;
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('\nDRILL ' + (ok ? 'PASS' : 'FAIL'));
console.log('  这是流程演练；真实 D1 数据库的恢复演练尚未执行，需另行完成并归档。');
process.exit(ok ? 0 : 1);
