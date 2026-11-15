/**
 * 补丁基线诊断 —— 用来区分「还没点应用」和「点了也不会生效」。
 *
 * 后者是宿主被改过（第三方补丁 / 版本不同）的信号，
 * 以前在列表里只显示成 skipped，看不出区别。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { diagnosePatchText, diagnosePatches, patternSample } from "../lib/core.js";

/**
 * Windows 上刚写完的文件常被杀软/索引器短暂占用，Node 22.5 的 rimraf 会抛 EPERM。
 * 临时目录交给系统回收即可，不让清理失败把测试判成失败。
 */
function cleanupTmp(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 留给系统临时目录清理 */
  }
}

const patch = {
  id: 9101,
  name: "TEST_BASELINE",
  layer: "代码",
  layer_en: "Code",
  file: "settings",
  replacements: [{ pattern: "const ORIGINAL_THING = 1;", replace: "const ORIGINAL_THING = 2;" }],
  markers: ["[dsh-purge] baseline test"],
  markersAny: true,
  skipIfMarked: true,
};

test("原文在 → pending（值得点应用）", () => {
  const r = diagnosePatchText("const ORIGINAL_THING = 1;\n", patch, "/tmp/x.js");
  assert.equal(r.outcome, "pending");
  assert.equal(r.misses.length, 0);
});

test("已经生效 → applied", () => {
  const r = diagnosePatchText("const ORIGINAL_THING = 1; // [dsh-purge] baseline test\n", patch, "/tmp/x.js");
  assert.equal(r.outcome, "applied");
  assert.equal(r.misses.length, 0);
});

test("原文不在、marker 也没有 → 判为对不上，并给出未命中的原文样例", () => {
  const r = diagnosePatchText("const REWRITTEN_BY_SOMEONE_ELSE = 9;\n", patch, "/tmp/x.js");
  assert.equal(r.outcome, "skipped");
  assert.equal(r.misses.length, 1);
  assert.match(r.misses[0], /ORIGINAL_THING/);
});

test("patternSample 压成一行并截断", () => {
  assert.equal(patternSample("a();\nb();"), "a();");
  const long = patternSample("x".repeat(200));
  assert.equal(long.length, 65);
  assert.ok(long.endsWith("…"));
  assert.match(patternSample(/foo\s+bar/), /^\/foo/);
});

test("diagnosePatches 在伪造宿主上把不匹配记成 stale", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-baseline-"));
  const aiBase = path.join(root, "@deepseek-ai");
  const dir = path.join(aiBase, "dsh-agent-instructions", "lib");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.js"), "// 被别人改过的宿主文件\nconst somethingElse = 1;\n");
  fs.writeFileSync(path.join(dir, "bootstrap.js"), "// bootstrap\n");
  try {
    const { rows, summary } = await diagnosePatches(aiBase);
    assert.ok(rows.length > 0, "应当至少诊断出一条补丁");
    assert.ok(summary.stale > 0, "伪造宿主上应当有对不上的补丁");
    const staleRow = rows.find((r) => r.stale > 0);
    assert.ok(staleRow, "应当有一条 stale 记录");
    assert.equal(staleRow.settled, 0);
    assert.ok(staleRow.scanned > 0);
    assert.ok(Array.isArray(staleRow.misses));
  } finally {
    cleanupTmp(root);
  }
});

test("applyPatchesAllHosts 能完整跑完并返回结果（回归：返回结构/变量名）", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-apply-"));
  const aiBase = path.join(root, "@deepseek-ai");
  const dir = path.join(aiBase, "dsh-agent-instructions", "lib");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.js"), "const untouched = 1;\n");
  fs.writeFileSync(path.join(dir, "bootstrap.js"), "const bootstrap = 1;\n");
  const home = path.join(root, "home");
  fs.mkdirSync(home, { recursive: true });
  const prevHome = process.env.DSH_HOME;
  const prevBase = process.env.DSH_BASE;
  process.env.DSH_HOME = home;
  process.env.DSH_BASE = aiBase;
  try {
    const { applyPatchesAllHosts, patchesForPromptOnly } = await import("../lib/core.js");
    const res = await applyPatchesAllHosts(patchesForPromptOnly(), { aiBases: [aiBase], forApply: true });
    assert.ok(Array.isArray(res.hosts), "hosts 必须是数组");
    assert.equal(res.hosts.length, 1);
    assert.ok(Array.isArray(res.report));
    assert.ok(Array.isArray(res.failures), "failures 必须是数组");
    assert.ok(Array.isArray(res.hookDenyRestoreFailed), "hookDenyRestoreFailed 必须是数组");
  } finally {
    if (prevHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prevHome;
    if (prevBase === undefined) delete process.env.DSH_BASE;
    else process.env.DSH_BASE = prevBase;
    cleanupTmp(root);
  }
});
