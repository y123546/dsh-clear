/**
 * 版本范围判定 —— dshTarget 闸门的地基。
 * 这里覆盖的是"宿主升级后补丁静默失效"那类故障的判定部分。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { versionSatisfies, hostCompat } from "../lib/core.js";

test(">= 允许更高的小版本", () => {
  assert.equal(versionSatisfies("0.2.2", ">=0.2.2"), true);
  assert.equal(versionSatisfies("0.2.3", ">=0.2.2"), true);
  assert.equal(versionSatisfies("0.3.0", ">=0.2.2"), true);
});

test(">= 拒绝更低版本与预发布", () => {
  assert.equal(versionSatisfies("0.2.1", ">=0.2.2"), false);
  assert.equal(versionSatisfies("0.2.2-rc.1", ">=0.2.2"), false);
});

test("精确匹配与 v 前缀", () => {
  assert.equal(versionSatisfies("v0.2.2", "0.2.2"), true);
  assert.equal(versionSatisfies("0.2.3", "0.2.2"), false);
});

test("^ 锁主版本、~ 锁次版本", () => {
  assert.equal(versionSatisfies("0.2.9", "^0.2.2"), true);
  assert.equal(versionSatisfies("0.3.0", "^0.2.2"), false);
  assert.equal(versionSatisfies("0.2.9", "~0.2.2"), true);
  assert.equal(versionSatisfies("0.3.0", "~0.2.2"), false);
});

test("空格合取与 || 分支", () => {
  assert.equal(versionSatisfies("0.2.5", ">=0.2.2 <0.3.0"), true);
  assert.equal(versionSatisfies("0.3.1", ">=0.2.2 <0.3.0"), false);
  assert.equal(versionSatisfies("0.3.1", ">=0.2.2 <0.3.0 || >=0.3.1"), true);
});

test("* 与空范围表示不限", () => {
  assert.equal(versionSatisfies("9.9.9", "*"), true);
  assert.equal(versionSatisfies("9.9.9", ""), true);
});

test(">=0.2.2-0 涵盖同号预发布引擎（如 0.2.2-rc.1）", () => {
  assert.equal(versionSatisfies("0.2.2-rc.1", ">=0.2.2-0"), true);
  assert.equal(versionSatisfies("0.2.2", ">=0.2.2-0"), true);
  assert.equal(versionSatisfies("0.2.1", ">=0.2.2-0"), false);
  // rc 也算满足之后，常见误判是把它当成 ">=0.2.2" 放行了 0.2.1
  assert.equal(versionSatisfies("0.2.1-rc.9", ">=0.2.2-0"), false);
});

test("读不到宿主版本时闸门给出 unknown 而不是误报不兼容", () => {
  const compat = hostCompat("/nonexistent/definitely-not-a-host");
  assert.equal(compat.unknown, true);
  assert.equal(compat.ok, null);
  assert.match(compat.reason, /跳过|读不到/);
});
