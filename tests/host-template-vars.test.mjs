import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CWD_ONLY_SUFFIX,
  escapeDshInterpolation,
  sanitizeHostTemplateVars,
  rewritePromptAssembly,
} from "../lib/identity.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 手机 dsh-Go 的模板引擎只注册 provider/model；出现 {{cwd}} 会在
// deployment:persona-suffix 渲染阶段抛 `unknown prompt variable "{{cwd}}"`。
test("persona suffix 常量不含任何模板变量", () => {
  assert.ok(!CWD_ONLY_SUFFIX.includes("{{"));
  assert.ok(!CWD_ONLY_SUFFIX.includes("cwd}}"));
});

test("escapeDshInterpolation 不再放行 cwd，只保留 model/provider", () => {
  const out = escapeDshInterpolation("{{cwd}} / {{model}} / {{provider}} / {{foo}}");
  assert.ok(!out.includes("{{cwd}}"), out);
  assert.ok(out.includes("{{model}}"), out);
  assert.ok(out.includes("{{provider}}"), out);
  assert.ok(!out.includes("{{foo}}"), out);
});

test("sanitizeHostTemplateVars 把 {{cwd}} 换成真实路径或中性文本", () => {
  const out = sanitizeHostTemplateVars("Your working directory is {{cwd}}.");
  assert.ok(!out.includes("{{cwd}}"), out);
  assert.ok(!out.includes("{{"), out);
  assert.match(out, /working directory is \S/i);
});

test("profile 挂载补丁里的 personaSuffix 是纯文本", () => {
  const yml = readFileSync(path.join(root, "cordis.patch.yml"), "utf8");
  const line = yml.split(/\r?\n/).find((l) => l.trim().startsWith("personaSuffix:"));
  assert.ok(line, "cordis.patch.yml 缺少 personaSuffix");
  assert.ok(!line.includes("{{"), line);
});

test("rewritePromptAssembly 输出的所有段都不含 {{cwd}}", () => {
  const assembled = {
    sections: [
      { name: "deployment:persona-prefix", text: "" },
      { name: "deployment:persona-suffix", text: "Your working directory is {{cwd}}." },
      { name: "user-rules", text: "workspace hint: {{cwd}} / model {{model}}" },
    ],
    contexts: [],
    tools: [],
  };
  const out = rewritePromptAssembly(assembled, "", { capabilityProtocol: false });
  assert.ok(Array.isArray(out.sections));
  for (const section of out.sections) {
    assert.ok(
      !String(section?.text || "").includes("{{cwd}}"),
      `段 ${section?.name} 仍含 {{cwd}}: ${String(section?.text).slice(0, 120)}`,
    );
  }
  const suffix = out.sections.find((s) => s.name === "deployment:persona-suffix");
  assert.ok(suffix, "persona-suffix 段应保留");
  assert.ok(!String(suffix.text).includes("{{"), suffix.text);
});
