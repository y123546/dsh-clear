/**
 * 红队证据账本（从 1.1.73 移植）。
 *
 * 核心是"claimed 不能当 observed 用"：子智能体口头回报必须能被核实，
 * ev_id 由内容哈希生成，改一个字就对不上。
 *
 * 移植时改了一处：上游静态 `import { DatabaseSync } from 'node:sqlite'`，
 * 只用于 JSDoc 类型标注，却会让 Node < 22.5 整个模块加载失败 —— 已去掉。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EVIDENCE_LEDGER_DDL, EvidenceLedger, UnknownRegistry, evidenceId } from "../lib/redteam/evidence-ledger.mjs";
import { sqliteStatus, requireDatabaseSync } from "../lib/redteam/schema.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const enabled = sqliteStatus().ok;

function openDb() {
  const Ctor = requireDatabaseSync();
  const db = new Ctor(":memory:");
  db.exec(EVIDENCE_LEDGER_DDL);
  return db;
}

test("账本模块不静态依赖 node:sqlite（低版本 Node 也能加载）", () => {
  const src = fs.readFileSync(path.join(ROOT, "lib/redteam/evidence-ledger.mjs"), "utf8");
  assert.doesNotMatch(src, /^\s*import\s+\{[^}]*\}\s+from\s+["']node:sqlite["']/m);
});

test("ev_id 是内容的函数：改一个字就变", () => {
  const base = { operation: "nmap_scan", parameters: { target: "10.0.0.1" }, result: { ports: [80] }, confidence: "observed", authority: "tool-output", limitations: [], supporting_ev_ids: [] };
  const a = evidenceId(base);
  const b = evidenceId({ ...base, result: { ports: [80, 443] } });
  assert.match(a, /^ev_[0-9a-f]{64}$/);
  assert.notEqual(a, b);
});

test("记录 → 核实 → 升级 claimed 为 observed", { skip: !enabled && "需要 node:sqlite（Node >= 22.5）" }, () => {
  const db = openDb();
  try {
    const ledger = new EvidenceLedger(db);
    const rec = ledger.record({ operation: "webshell_check", result: { alive: true }, confidence: "claimed", source_agent: "exploit", engagement_id: 1 });
    assert.equal(rec.ok, true, JSON.stringify(rec));
    assert.ok(rec.ev_id);

    const again = ledger.verify({ operation: "webshell_check", result: { alive: true }, confidence: "claimed" });
    assert.equal(again.matched, true);
    assert.equal(again.ev_id, rec.ev_id);

    const miss = ledger.verify({ operation: "webshell_check", result: { alive: false }, confidence: "claimed" });
    assert.equal(miss.matched, false);

    const up = ledger.upgrade({ claimed_ev_id: rec.ev_id, verified_by: "coordinator", verified_result: { alive: true } });
    assert.equal(up.ok, true, JSON.stringify(up));
    // 纪律：原始 claimed 记录永久保留（审计不断链），升级是新增一条 observed 并回链
    assert.equal(ledger.get(rec.ev_id).confidence, "claimed");
    assert.notEqual(up.ev_id, rec.ev_id);
    const verified = ledger.get(up.ev_id);
    assert.equal(verified.confidence, "observed");
    assert.deepEqual(verified.supporting_ev_ids, [rec.ev_id]);
    // 裸数仍是 1（claimed 永远算"未核实"），但闭环计数应为 0
    assert.equal(ledger.countUnverified(1), 1);
    assert.equal(ledger.countUnresolvedClaims(1), 0);
  } finally {
    db.close();
  }
});

test("未核实条目会被计数（claimed 不能当结论用）", { skip: !enabled && "需要 node:sqlite" }, () => {
  const db = openDb();
  try {
    const ledger = new EvidenceLedger(db);
    ledger.record({ operation: "a", result: { x: 1 }, confidence: "claimed", engagement_id: 7 });
    ledger.record({ operation: "b", result: { x: 2 }, confidence: "inferred", engagement_id: 7 });
    ledger.record({ operation: "c", result: { x: 3 }, confidence: "observed", engagement_id: 7 });
    assert.equal(ledger.countUnverified(7), 2);
  } finally {
    db.close();
  }
});

test("未知项登记 → 解决后不再出现在 open 列表", { skip: !enabled && "需要 node:sqlite" }, () => {
  const db = openDb();
  try {
    const reg = new UnknownRegistry(db);
    const rec = reg.record({ question: "内网是否有第二台 DC", severity: "high", engagement_id: 1 });
    assert.equal(rec.ok, true, JSON.stringify(rec));
    assert.equal(reg.list({ status: "open" }).length, 1);
    const id = reg.list({ status: "open" })[0].unk_id || reg.list({ status: "open" })[0].id;
    const done = reg.resolve(id, "resolved", "确认只有一台");
    assert.equal(done.ok, true, JSON.stringify(done));
    assert.equal(reg.list({ status: "open" }).length, 0);
  } finally {
    db.close();
  }
});

test("工具集里确实注册了那 8 个证据/未知项工具", () => {
  const src = fs.readFileSync(path.join(ROOT, "lib/redteam/tools.js"), "utf8");
  for (const name of [
    "redteam_evidence_record", "redteam_evidence_verify", "redteam_evidence_upgrade", "redteam_evidence_list",
    "redteam_unknown_record", "redteam_unknown_resolve", "redteam_unknown_list", "redteam_unverified_count",
  ]) {
    assert.match(src, new RegExp(`name: '${name}'`), `缺工具 ${name}`);
  }
  assert.match(src, /from '\.\/evidence-ledger\.mjs'/, "tools.js 应当引用账本模块");
});
