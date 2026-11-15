import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * dsh-Go 的 App 在列「Agent 预设」时会预解析 preset 声明的组件。
 * 那个上下文的 process.argv[1] 不是 dsh/lib/bin.js，模块顶层若去解析
 * @deepseek-ai/dsh-tools 就会抛错，整份「红队模式」被标成「加载失败」。
 */
test("红队工具模块在解析不到宿主包时仍能加载", async () => {
  const mod = await import("../lib/redteam/tools.js");
  assert.equal(mod.name, "dsh-purge-redteam-tools");
  assert.ok(Array.isArray(mod.inject) && mod.inject.includes("tools"));
  assert.equal(typeof mod.apply, "function");
});

test("repairDelegation 不再在 dsh-Go 上强制启用没有导出的 list-agents", () => {
  const src = readFileSync(path.join(root, "lib", "redteam", "index.js"), "utf8");
  assert.ok(src.includes("GO_FORCE_ENABLE_SKIP"), "缺少平台感知排除表");
  assert.ok(src.includes("tool-subagent-list-agents"), "排除表应包含 list-agents");
  // 排除判断必须在自愈循环（repairDelegation 的 for 循环）里
  const skipCall = src.indexOf("GO_FORCE_ENABLE_SKIP.has(id)");
  const loopStart = src.indexOf('for (const id of [');
  assert.ok(skipCall > loopStart, "排除判断不在自愈循环里");
});

test("defineTool 保持惰性：不得回到模块顶层直接解析", () => {
  const src = readFileSync(path.join(root, "lib", "redteam", "tools.js"), "utf8");
  assert.ok(!/const\s+defineTool\s*=\s*loadDefineTool\s*\(\s*\)/.test(src), "顶层解析会让预设加载失败");
  assert.ok(src.includes("cachedDefineTool"), "缺少惰性缓存");
});

test("解析器保留 dsh-Go 固定宿主路径兜底", () => {
  const src = readFileSync(path.join(root, "lib", "redteam", "tools.js"), "utf8");
  assert.ok(src.includes("/opt/dsh"), "缺少 /opt/dsh 候选");
  assert.ok(src.includes("DSH_GO_ENGINE_ROOT"), "缺少引擎根目录环境变量兜底");
});
