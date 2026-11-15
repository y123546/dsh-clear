import test from "node:test";
import assert from "node:assert/strict";
import { GO_HOST_EXTRA_TARGETS, GO_HOST_VARIANTS } from "../lib/go-host-variants.js";
import { ALL_PATCHES, applyReplacementsToText, diagnosePatchText } from "../lib/core.js";

const GO_IDS = [14, 17, 32, 40, 53, 54, 60, 62, 67, 74, 77, 80];

function withGoHost(forced, fn) {
  const prev = process.env.DSH_PURGE_GO_HOST;
  process.env.DSH_PURGE_GO_HOST = forced;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.DSH_PURGE_GO_HOST;
    else process.env.DSH_PURGE_GO_HOST = prev;
  }
}

test("适配层覆盖手机上全部 12 个对不上的补丁", () => {
  for (const id of GO_IDS) {
    assert.ok(GO_HOST_VARIANTS[id], `#${id} 缺适配项`);
    assert.ok(Array.isArray(GO_HOST_VARIANTS[id].variants), `#${id} 缺 variants`);
  }
  assert.equal(Object.keys(GO_HOST_EXTRA_TARGETS).length, 6);
  for (const [key, parts] of Object.entries(GO_HOST_EXTRA_TARGETS)) {
    assert.ok(parts.length >= 3, `${key} 路径片段不完整`);
    assert.ok(parts[0].startsWith("dsh-"), `${key} 包名不对`);
  }
});

test("变体的 pattern 都能在手机宿主原文样本里命中，替换后判为 applied", () => {
  withGoHost("1", () => {
    for (const id of GO_IDS) {
      const patch = ALL_PATCHES.find((p) => p.id === id);
      const variant = GO_HOST_VARIANTS[id];
      assert.ok(patch, `#${id} 补丁不存在`);
      if (variant.variants.length === 0) continue;
      // 用变体自己的原文当样本：验证 apply 确实改得动、且产物带标记。
      for (const v of variant.variants) {
        // #17 的 markers 要 writeIntent 与 editIntent 两处标记同时存在，
        // 真实宿主里 writeIntent 早已带标记，样本补上这一行才等效。
        const prefix = id === 17 ? "\twriteIntent(target, actor) {\n\t\t// [dsh-purge] observation bypass: writes are unconditional.\n\t\treturn void 0;\n\t}\n" : "";
        const sample = prefix + v.pattern;
        const out = applyReplacementsToText(sample, patch, "host.js");
        assert.equal(out.changed, true, `#${id} 变体没匹配上自己的原文`);
        assert.notEqual(out.text, sample, `#${id} 替换后文本没变`);
        assert.equal(diagnosePatchText(out.text, patch, "host.js").outcome, "applied", `#${id} 替换后仍不算已生效`);
      }
    }
  });
});

test("桌面版匹配串一字未动：桌面原文仍能命中，手机变体在桌面不生效", () => {
  withGoHost("0", () => {
    for (const id of GO_IDS) {
      const patch = ALL_PATCHES.find((p) => p.id === id);
      const base = Array.isArray(patch.replacements)
        ? patch.replacements
        : (patch.patterns ?? []).map((pattern) => ({ pattern, replace: patch.replace }));
      for (const r of base) {
        if (typeof r.pattern !== "string" || typeof r.replace !== "string") continue;
        // #40 有一条 pattern === replace 的幂等占位（已是最新时不再改文件），
        // 它本来就不会 changed，跳过。
        if (r.pattern === r.replace) continue;
        const out = applyReplacementsToText(r.pattern, patch, "desktop.js");
        assert.equal(out.changed, true, `桌面环境 #${id} 原匹配串失效了`);
      }
    }
  });
});

test("手机变体只在 dsh-Go 环境生效（用 #62 的 void 0 分支做隔离验证）", () => {
  const patch = ALL_PATCHES.find((p) => p.id === 62);
  const goOnly = GO_HOST_VARIANTS[62].variants[0].pattern;
  assert.ok(goOnly.includes("approval === void 0"));
  withGoHost("0", () => {
    const out = applyReplacementsToText(goOnly, patch, "desktop.js");
    assert.equal(out.changed, false, "桌面环境误用了手机变体");
  });
  withGoHost("1", () => {
    const out = applyReplacementsToText(goOnly, patch, "host.js");
    assert.equal(out.changed, true, "dsh-Go 环境没有应用手机变体");
    assert.ok(out.text.includes("[dsh-purge] no approval service → allow"));
  });
});

test("#80 目标已达成时收敛：手机 preset 没有 parity 注释即视为完成", () => {
  const patch = ALL_PATCHES.find((p) => p.id === 80);
  const cleanPreset = "- id: persistent-shell\n  name: cordis:group\n";
  withGoHost("1", () => {
    assert.ok(GO_HOST_VARIANTS[80].softSettle);
    assert.equal(diagnosePatchText(cleanPreset, patch, "minimal.patch.yml").outcome, "applied");
  });
  withGoHost("0", () => {
    // 桌面环境仍是原来的 optional/skipIfMarked 行为，不被手机规则带偏
    assert.equal(diagnosePatchText(cleanPreset, patch, "minimal.patch.yml").outcome, "skipped");
  });
});

test("#53 replaceBase 不会误删被冻结的历史提示词段落", () => {
  const patch = ALL_PATCHES.find((p) => p.id === 53);
  const legacy = 'const LEGACY_WEB_SURFACE = {\n\tsuffix: ". Do not start a replacement server unless the user asks; if one is needed, use a managed background job and verify its exact URL."\n};\n';
  withGoHost("1", () => {
    const out = applyReplacementsToText(legacy, patch, "host.js");
    assert.equal(out.changed, false, "历史段落被改了");
    assert.ok(out.text.includes("Do not start a replacement server"), "历史段落的禁止句被删了");
  });
});
