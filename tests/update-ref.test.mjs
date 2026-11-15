/**
 * 更新链路里的 ref 白名单。
 * 这次改动把硬编码的 `master` 换成了 STABLE_REF（main），
 * 顺手锁住"任何奇怪字符串都不能进 git/URL 拼接"这条边界。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { safeUpdateRef } from "../lib/update.js";

test("接受分支、标签与短 sha", () => {
  assert.equal(safeUpdateRef("main"), "main");
  assert.equal(safeUpdateRef("beta"), "beta");
  assert.equal(safeUpdateRef("v0.2.2"), "v0.2.2");
  assert.equal(safeUpdateRef("0.2.2"), "0.2.2");
  assert.equal(safeUpdateRef("0.2.2-rc.1"), "0.2.2-rc.1");
  assert.equal(safeUpdateRef("4be7055"), "4be7055");
  assert.equal(safeUpdateRef("4be7055abcdef0123456789abcdef0123456789"), "4be7055abcdef0123456789abcdef0123456789");
});

test("拒绝路径穿越与命令拼接", () => {
  assert.equal(safeUpdateRef("../../etc/passwd"), "");
  assert.equal(safeUpdateRef("main; rm -rf /"), "");
  assert.equal(safeUpdateRef("main && curl evil"), "");
  assert.equal(safeUpdateRef("`whoami`"), "");
  assert.equal(safeUpdateRef(""), "");
  assert.equal(safeUpdateRef(null), "");
});
