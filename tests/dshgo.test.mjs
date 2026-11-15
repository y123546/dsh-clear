/**
 * dsh-Go 原生面板：清单、视图、数据、插槽注册。
 *
 * 这里的用例守的是"装了之后 App 里真能显示"：
 *   · 清单字段合法（id 唯一、文字长度、面板引用存在、≤16 KiB）
 *   · 视图结构合法，数字全走绑定
 *   · 数据是完整对象（协议要求每次给全量）
 *   · 注册到 ctx.dshGo 的三个入口都拿得到东西，按钮返回可执行效果
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { purgePanelView, panelDataFor, stripFor, pickRows } from "../lib/dshgo-view.js";
import { installDshGo } from "../lib/dshgo.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const manifest = pkg.dshGo;

const COMPONENTS = new Set([
  "stack", "row", "text", "metric", "chart", "compare", "steps", "callout",
  "options", "confirm", "list", "keyValue", "progress", "table", "actions", "image",
]);
const TONES = new Set(["info", "good", "warn", "bad", "muted"]);

function walk(node, visit, at = "$") {
  visit(node, at);
  for (const [i, child] of (node.children || []).entries()) walk(child, visit, `${at}.children[${i}]`);
}

/* ------------------------------ 清单 ------------------------------ */

test("dshGo 清单：v=1、字数与引用都对得上", () => {
  assert.equal(manifest.v, 1);
  const ids = [];
  for (const [slot, entries] of Object.entries(manifest.contributes)) {
    assert.ok(Array.isArray(entries) && entries.length > 0, `${slot} 必须是非空数组`);
    for (const item of entries) {
      ids.push(item.id);
      assert.match(item.id, /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/, `${slot}.${item.id} 不合法`);
    }
  }
  assert.equal(new Set(ids).size, ids.length, "同一插件内 id 不能重复");

  const panelIds = new Set(manifest.contributes.panels.map((p) => p.id));
  for (const strip of manifest.contributes["composer.strip"] || []) {
    if (strip.panel) assert.ok(panelIds.has(strip.panel), `strip 引用了不存在的面板 ${strip.panel}`);
  }
  for (const action of manifest.contributes["composer.actions"] || []) {
    assert.ok(String(action.label.zh).length <= 10, "胶囊 label ≤ 10 字");
  }
  for (const panel of manifest.contributes.panels) {
    assert.ok(String(panel.title.zh).length <= 16, "面板 title ≤ 16 字");
    assert.equal(panel.placement.includes("session.tab"), true);
  }
  assert.ok(Buffer.byteLength(JSON.stringify(manifest), "utf8") <= 16 * 1024, "dshGo 整体 ≤ 16 KiB");
});

/* ------------------------------ 视图 ------------------------------ */

test("面板视图：结构合法，数字全部走绑定", () => {
  const view = purgePanelView({ sessionId: "s1" }, { locale: "zh-CN" });
  assert.equal(view.type, "stack");
  const bound = [];
  walk(view, (node, at) => {
    assert.ok(COMPONENTS.has(node.type), `${at} 的 type=${node.type} 不在 v1 组件里`);
    if (node.tone !== undefined && typeof node.tone === "string") {
      assert.ok(TONES.has(node.tone), `${at} 的 tone=${node.tone} 非法`);
    }
    if (node.value && typeof node.value === "object") bound.push(node.value.$);
    if (node.text && typeof node.text === "object") bound.push(node.text.$);
    if (node.items && !Array.isArray(node.items) && typeof node.items === "object") bound.push(node.items.$);
    if (node.tone && typeof node.tone === "object") bound.push(node.tone.$);
  });
  assert.deepEqual(bound.filter(Boolean).sort(), [
    "data.applied", "data.env", "data.more", "data.note", "data.pending", "data.rows", "data.stale", "data.tone",
  ].sort());
  assert.ok(Buffer.byteLength(JSON.stringify(view), "utf8") < 16 * 1024);
});

test("面板视图：三个按钮的动作 id 与处理器同名", () => {
  const view = purgePanelView({}, { locale: "zh-CN" });
  const actions = view.children.find((c) => c.type === "actions");
  assert.deepEqual(actions.items.map((i) => i.action.id), ["apply", "revert", "refresh"]);
  assert.equal(actions.items[0].style, "primary");
});

test("英文 locale 出英文标签", () => {
  const view = purgePanelView({}, { locale: "en-US" });
  const row = view.children.find((c) => c.type === "row");
  assert.deepEqual(row.children.map((m) => m.label), ["Applied", "Pending", "Mismatch"]);
});

/* ------------------------------ 数据 ------------------------------ */

const snap = {
  ok: true,
  env: "dsh-Go 手机引擎（web）",
  total: 82,
  applied: 62,
  pending: 3,
  stale: 17,
  rows: [
    { id: 42, name: "SETTINGS_LEGACY_API", layer: "代码", status: "applied" },
    { id: 7, name: "SANDBOX_POLICY", layer: "代码", status: "pending" },
    { id: 12, name: "APPROVAL_GATE", layer: "代码", status: "skipped" },
  ],
};

test("数据：对不上的行排最前，文案按状态切换", () => {
  const data = panelDataFor(snap, "zh-CN");
  assert.equal(data.applied, "62");
  assert.equal(data.pending, "3");
  assert.equal(data.stale, "17");
  assert.equal(data.tone, "warn");
  assert.match(data.note, /17 个补丁/);
  assert.deepEqual(data.rows.map((r) => r.title), [
    "#12 APPROVAL_GATE",
    "#7 SANDBOX_POLICY",
    "#42 SETTINGS_LEGACY_API",
  ]);
  assert.equal(data.rows[0].tone, "bad");
});

test("数据：环境读不到时给红条而不是谎报已齐", () => {
  const data = panelDataFor({ ok: false, env: "web", total: 0, applied: 0, pending: 0, stale: 0, rows: [] }, "zh-CN");
  assert.equal(data.tone, "bad");
  assert.match(data.note, /DSH_BASE/);
});

test("数据：全对齐时是 good + 已齐文案", () => {
  const data = panelDataFor({ ...snap, pending: 0, stale: 0, applied: 82 }, "zh-CN");
  assert.equal(data.tone, "good");
  assert.match(data.note, /已齐/);
});

test("数据：异常快照不会把 undefined 写进视图", () => {
  const data = panelDataFor({ error: "boom" }, "zh-CN");
  assert.equal(typeof data.note, "string");
  assert.deepEqual(data.rows, []);
  assert.doesNotMatch(JSON.stringify(data), /undefined/);
});

test("pickRows 上限 20 行", () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ id: i, name: `P${i}`, layer: "代码", status: "applied" }));
  assert.equal(pickRows(many).length, 20);
});

test("状态条：文字 ≤ 24 字", () => {
  for (const s of [snap, { ...snap, stale: 0, pending: 0 }, { ok: false }, { error: "x" }]) {
    const strip = stripFor(s, "zh-CN");
    assert.ok([...strip.text].length <= 24, `状态条超长：${strip.text}`);
    assert.ok(TONES.has(strip.tone));
  }
});

/* ------------------------------ 注册 ------------------------------ */

function fakeCtx(api) {
  const ctx = {
    inject(deps, cb) {
      assert.deepEqual(deps, ["dshGo"]);
      cb({ dshGo: api, effect: () => {} });
    },
  };
  return ctx;
}

function fakeApi() {
  const api = { panel: null, strip: null, on: {} };
  api.panel = (id, opts) => {
    api.panelId = id;
    api.panelOpts = opts;
  };
  api.strip = (id, fn) => {
    api.stripId = id;
    api.stripFn = fn;
  };
  api.on = (id, fn) => {
    api.on[id] = fn;
  };
  return api;
}

const fakeCore = {
  gatherState: async () => ({
    ai_base: "F:/fake",
    host_env: "dsh-Go 手机引擎（web）",
    surface: "web",
    patch_status: { 1: "applied", 2: "pending", 3: "skipped", 4: "na" },
  }),
  ALL_PATCHES: [
    { id: 1, name: "A", layer: "提示词" },
    { id: 2, name: "B", layer: "代码" },
    { id: 3, name: "C", layer: "代码" },
    { id: 4, name: "D", layer: "工具" },
  ],
};

test("注册：面板/状态条/胶囊都挂上，数据能推出来", async () => {
  const api = fakeApi();
  installDshGo(fakeCtx(api), { core: fakeCore });
  assert.equal(api.panelId, "purge");
  assert.equal(api.stripId, "status");

  const got = [];
  const off = api.panelOpts.data({}, (d) => got.push(d), { locale: "zh-CN" });
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(got.length >= 1, "订阅后应当推一次数据");
  assert.equal(got.at(-1).applied, "1");
  assert.equal(got.at(-1).stale, "1");
  assert.equal(got.at(-1).rows.length, 3);
  off();

  const stripGot = [];
  api.stripFn({}, (d) => stripGot.push(d), { locale: "zh-CN" });
  await new Promise((r) => setTimeout(r, 20));
  assert.match(stripGot.at(-1).text, /1\/3/);
});

test("按钮返回斜杠命令效果，不是直接跑补丁", () => {
  const api = fakeApi();
  installDshGo(fakeCtx(api), { core: fakeCore });
  assert.deepEqual(api.panelOpts.actions.apply({}, {}), { command: { name: "purge", args: "apply" } });
  assert.deepEqual(api.panelOpts.actions.revert({}, {}), { command: { name: "purge", args: "revert" } });
  assert.deepEqual(api.on.apply({}, {}), { command: { name: "purge", args: "apply" } });
  const toast = api.panelOpts.actions.refresh({}, {}).toast;
  assert.ok([...toast].length <= 40, "toast ≤ 40 字");
});

test("没有桥接时什么都不注册，也不抛", () => {
  const ctx = { inject: (_deps, _cb) => {} };
  assert.doesNotThrow(() => installDshGo(ctx, { core: fakeCore }));
});
