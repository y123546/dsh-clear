/**
 * 语法检查：把每个 .js/.mjs 复制成临时 .mjs 再交给 `node --check`。
 *
 * 为什么不直接 `node --check x.js`：本仓库 `"type": "module"`，
 * 但 `node --check` 对 .js 默认按 CommonJS 解析，会把 `import` 报成语法错。
 * 复制成 .mjs 才是按 ESM 检查。
 *
 * 用法：node scripts/check-syntax.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", ".git", ".github"]);
const EXTS = new Set([".js", ".mjs"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const fp = path.join(dir, name);
    const st = statSync(fp);
    if (st.isDirectory()) walk(fp, out);
    else if (EXTS.has(path.extname(name))) out.push(fp);
  }
  return out;
}

const files = walk(ROOT).sort();
const tmp = mkdtempSync(path.join(tmpdir(), "dsh-purge-syntax-"));
const failures = [];
let checked = 0;

try {
  for (const fp of files) {
    const probe = path.join(tmp, `probe-${checked}.mjs`);
    writeFileSync(probe, readFileSync(fp));
    checked += 1;
    try {
      execFileSync(process.execPath, ["--check", probe], { stdio: "pipe" });
    } catch (e) {
      const stderr = String((e && e.stderr) || "").trim();
      failures.push({ file: path.relative(ROOT, fp), detail: stderr.split("\n").slice(0, 4).join("\n") });
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`语法检查失败 ${failures.length}/${checked} / syntax errors:`);
  for (const f of failures) console.error(`  ✗ ${f.file}\n${f.detail}`);
  process.exit(1);
}
console.log(`语法检查通过 / syntax ok: ${checked} 个文件`);
