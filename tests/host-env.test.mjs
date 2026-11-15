/**
 * 宿主环境识别 —— dsh-Go 手机引擎与普通宿主的差别。
 *
 * 这些差别不是"锦上添花"，是两个真会出事的点：
 *   · 引擎由 App 托管，插件自己 spawn 重启会把 App 手里的进程顶掉；
 *   · 引擎构建期被第三方 patch 过，代码补丁大面积对不上，只能退到提示词层。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { goHostInfo, describeHostEnv } from "../lib/surface.js";
import * as host from "../lib/host.js";
import { patchesForPromptOnly, ALL_PATCHES } from "../lib/core.js";

test("Windows 上不会误判成手机引擎", () => {
  const info = goHostInfo({ platform: "win32", env: {} });
  assert.equal(info.isGo, false);
});

test("普通 Linux（无 PRoot、无 /opt/dsh）不算手机引擎", () => {
  const info = goHostInfo({ platform: "linux", env: {} });
  assert.equal(info.isGo, false);
  assert.equal(info.managedRestart, false);
});

test("PRoot 环境变量是手机引擎的判据", () => {
  const info = goHostInfo({ platform: "linux", env: { PROOT_TMP_DIR: "/tmp/proot" } });
  assert.equal(info.isGo, true);
  assert.equal(info.managedRestart, true);
  assert.match(info.reasons.join(","), /PROOT_TMP_DIR/);
});

test("DSH_PURGE_GO_HOST=1/0 可强制认定或排除", () => {
  assert.equal(goHostInfo({ platform: "win32", env: { DSH_PURGE_GO_HOST: "1" } }).isGo, true);
  assert.equal(goHostInfo({ platform: "linux", env: { PROOT_TMP_DIR: "/x", DSH_PURGE_GO_HOST: "0" } }).isGo, false);
});

test("describeHostEnv 区分三种宿主", () => {
  assert.match(describeHostEnv({ platform: "win32", env: {} }), /Web|web/);
  assert.match(describeHostEnv({ platform: "linux", env: { PROOT_TMP_DIR: "/x" } }), /dsh-Go/);
});

test("手机引擎上不自行重启，只给 App 提示", () => {
  const prev = process.env.DSH_PURGE_GO_HOST;
  process.env.DSH_PURGE_GO_HOST = "1";
  try {
    const planned = host.scheduleRestart(null, null);
    assert.equal(planned.restarting, false);
    assert.equal(planned.manual, true);
    assert.match(String(planned.error), /App/);
  } finally {
    if (prev === undefined) delete process.env.DSH_PURGE_GO_HOST;
    else process.env.DSH_PURGE_GO_HOST = prev;
  }
});

test("提示词层筛选：非空且只含提示词层", () => {
  const subset = patchesForPromptOnly();
  assert.ok(subset.length > 0);
  assert.ok(subset.length < ALL_PATCHES.length);
  for (const p of subset) assert.equal(p.layer, "提示词");
});
