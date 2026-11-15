/**
 * 补丁幂等性 —— 这类插件最容易出的问题是"点两次应用，文件被叠两份"。
 * 用合成补丁锁住两个不变量：
 *   1. 有 marker 的补丁第二次应用不再改动文本；
 *   2. pattern 已不存在的补丁不会凭空写入内容。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { applyReplacementsToText, flattenTargetPaths } from "../lib/core.js";

const markedPatch = {
  id: 9001,
  name: "TEST_MARKED",
  layer: "代码",
  layer_en: "Code",
  file: "settings",
  replacements: [
    { pattern: "const A = 1;", replace: "const A = 1; // [dsh-purge] test marker" },
  ],
  markers: ["[dsh-purge] test marker"],
  markersAny: true,
  skipIfMarked: true,
};

test("带 marker 的补丁重复应用不叠加", () => {
  const src = "const A = 1;\nconst B = 2;\n";
  const first = applyReplacementsToText(src, markedPatch, "/tmp/not-yaml.js");
  assert.equal(first.changed, true);
  assert.equal(first.text, "const A = 1; // [dsh-purge] test marker\nconst B = 2;\n");

  const second = applyReplacementsToText(first.text, markedPatch, "/tmp/not-yaml.js");
  assert.equal(second.changed, false);
  assert.equal(second.text, first.text);
});

test("pattern 已不存在时不写入任何东西", () => {
  const src = "const somethingElse = 1;\n";
  const r = applyReplacementsToText(src, markedPatch, "/tmp/not-yaml.js");
  assert.equal(r.changed, false);
  assert.equal(r.text, src);
});

test("纯字符串 pattern 命中多处时全部替换（行为记录）", () => {
  const patch = {
    id: 9002,
    name: "TEST_ONE_SHOT",
    layer: "代码",
    layer_en: "Code",
    file: "settings",
    replacements: [{ pattern: "needle();", replace: "needle(); // done" }],
    markers: ["// done"],
    markersAny: true,
  };
  const src = "needle();\nneedle();\n";
  const r = applyReplacementsToText(src, patch, "/tmp/not-yaml.js");
  // 纯字符串 pattern 走 split/join：命中几处替换几处。幂等靠 markers + skipIfMarked 兜。
  assert.equal(r.text, "needle(); // done\nneedle(); // done\n");
});

test("CRLF 文本不会被替换成全 LF", () => {
  const src = "const A = 1;\r\nconst B = 2;\r\n";
  const r = applyReplacementsToText(src, markedPatch, "/tmp/not-yaml.js");
  assert.equal(r.text.includes("\r\n"), true);
});

test("flattenTargetPaths 展开所有文件且去重", () => {
  const flat = flattenTargetPaths({
    settings: ["C:/x/a.js", "C:/x/b.js"],
    other: ["C:/x/b.js", "C:/x/c.js"],
  });
  assert.deepEqual(flat, ["C:/x/a.js", "C:/x/b.js", "C:/x/c.js"]);
});

test("flattenTargetPaths 容忍空值", () => {
  assert.deepEqual(flattenTargetPaths({}), []);
  assert.deepEqual(flattenTargetPaths(null), []);
});
