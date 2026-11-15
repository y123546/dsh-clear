/**
 * dsh-Go 原生卡片的视图构造。
 *
 * 这些视图会被写进对话记录，所以有两条硬约束必须由测试守住：
 *   · 必须是可 JSON 序列化的普通对象（undefined / NaN 会让整次工具调用失败）
 *   · 序列化后 < 8 KiB（超了 App 直接丢弃整张卡）
 */
import test from "node:test";
import assert from "node:assert/strict";
import { statusView, resultView } from "../lib/go-view.js";
import { toolCard } from "../lib/tool-card.js";

const compact = { applied: 62, pending: 3, total: 82, stale: 17, host_env: "dsh-Go 手机引擎（web）" };

test("statusView 用紧凑数据出三张指标卡", () => {
  const view = statusView(compact);
  assert.equal(view.type, "stack");
  const row = view.children.find((c) => c.type === "row");
  assert.equal(row.children.length, 3);
  assert.deepEqual(row.children.map((m) => m.label), ["已生效", "待应用", "未匹配"]);
  assert.equal(row.children[2].tone, "bad");
  assert.match(view.title, /62\/82/);
});

test("statusView 也能吃 gatherState 的原始字段", () => {
  const view = statusView({
    display_applied: 10,
    display_pending: 0,
    display_total: 10,
    patch_status: { 1: "applied", 2: "skipped", 3: "unmatched", 4: "pending" },
    surface: "web",
  });
  const row = view.children.find((c) => c.type === "row");
  assert.equal(row.children[0].value, "10");
  // skipped + unmatched 计为未匹配；applied / pending 不计
  assert.equal(row.children[2].value, "2");
});

test("未匹配 > 0 时给警告条，而不是绿色结论", () => {
  const view = statusView({ ...compact });
  const callout = view.children.find((c) => c.type === "callout");
  assert.equal(callout.tone, "warn");
  assert.match(callout.text, /--doctor/);
});

test("全部对齐时给绿色结论", () => {
  const view = statusView({ applied: 82, pending: 0, total: 82, stale: 0 });
  const callout = view.children.find((c) => c.type === "callout");
  assert.equal(callout.tone, "good");
  assert.match(callout.text, /补丁已齐/);
});

test("resultView 按 ok 决定色调，并截断超长明细", () => {
  const okView = resultView("apply", { text: "清洗完成 / applied=62, already=20.", ok: true });
  assert.equal(okView.title, "应用完成");
  assert.equal(okView.children[0].tone, "good");

  const badView = resultView("revert", { text: "回滚完成 / reverted=3 conflicts=2.", ok: false });
  assert.equal(badView.title, "还原未完成");
  assert.equal(badView.children[0].tone, "warn");

  const long = resultView("apply", { text: "x".repeat(5000) });
  assert.ok(long.children[1].text.length < 1300, "明细必须截断");
});

test("视图可无损 JSON 化，且远小于 8 KiB 上限", () => {
  const cases = [statusView(compact), resultView("apply", { text: "y".repeat(3000) })];
  for (const view of cases) {
    const json = JSON.stringify(view);
    assert.equal(typeof json, "string");
    assert.ok(Buffer.byteLength(json, "utf8") < 8 * 1024);
    assert.doesNotMatch(json, /undefined|NaN|Infinity/);
  }
});

test("toolCard 把视图放进 dsh-go/view", () => {
  const card = toolCard(() => statusView(compact));
  const meta = card({}, {});
  assert.ok(meta["dsh-go/view"]);
  assert.equal(meta["dsh-go/view"].type, "stack");
});

test("toolCard 在构造抛错时返回空对象（不连累工具调用）", () => {
  const card = toolCard(() => {
    throw new Error("boom");
  });
  assert.deepEqual(card({}, {}), {});
});

test("toolCard 在超长时返回空对象（App 会丢整张卡，不如不出）", () => {
  const card = toolCard(() => ({ type: "text", text: "z".repeat(9000) }));
  assert.deepEqual(card({}, {}), {});
});

/* ---- 与 dsh-Go 官方 view.schema.json 对齐（只锁我们用到的子集） ---- */

const ALLOWED_TYPES = new Set([
  "stack", "row", "text", "metric", "callout", "progress", "list", "keyValue",
  "compare", "steps", "chart", "table", "actions", "image",
]);
const ALLOWED_TONE = new Set(["info", "good", "warn", "bad"]);
const REQUIRED = { stack: ["children"], row: ["children"], text: ["text"], metric: ["label", "value"], callout: ["text"], progress: ["value"] };

function walk(node, visit, path = "$") {
  visit(node, path);
  for (const [i, child] of (node.children || []).entries()) walk(child, visit, `${path}.children[${i}]`);
}

test("生成的视图符合官方 schema 的必填项与枚举", () => {
  for (const view of [statusView(compact), statusView({ applied: 1, pending: 0, total: 1, stale: 0 }), resultView("apply", { text: "done" })]) {
    walk(view, (node, path) => {
      assert.ok(ALLOWED_TYPES.has(node.type), `${path} 的 type=${node.type} 不在官方枚举里`);
      for (const key of REQUIRED[node.type] || []) {
        assert.ok(node[key] !== undefined && node[key] !== null, `${path} 缺必填字段 ${key}`);
      }
      if (node.tone !== undefined) {
        // text 节点只认 muted（schema 里是 const），其余组件只认 info/good/warn/bad。
        const ok = node.type === "text" ? node.tone === "muted" : ALLOWED_TONE.has(node.tone);
        assert.ok(ok, `${path} 的 tone=${node.tone} 非法（type=${node.type}）`);
      }
      assert.equal(typeof node.children === "undefined" || Array.isArray(node.children), true);
    });
  }
});

test("根节点 title 不超过 80 字（App 会截断）", () => {
  assert.ok(String(statusView(compact).title).length <= 80);
  assert.ok(String(resultView("apply", { text: "done" }).title).length <= 80);
});
