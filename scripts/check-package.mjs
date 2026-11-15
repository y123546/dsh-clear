/**
 * 包形状检查 —— 发布前最后一道闸门。
 *
 * 检查的都是"错了会静默出事"的项：
 *   · bin / 入口 / patch 文件是否真的存在（不存在则 `dsh plugin add` 装出来是个空壳）
 *   · repository / dsh.install 是否指向同一个仓库（否则面板"检查更新"永远读错地方）
 *   · 有没有把旧作者标识带回来（这个仓库明确要求不带）
 *
 * 用法：node scripts/check-package.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
const notes = [];

function fail(msg) {
  problems.push(msg);
}

const pkgPath = path.join(ROOT, "package.json");
let pkg;
try {
  pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
} catch (e) {
  console.error(`无法读取 package.json: ${e.message}`);
  process.exit(1);
}

/* ---- 基本字段 ---- */
if (!pkg.name) fail("package.json 缺 name");
if (!/^\d+\.\d+\.\d+/.test(String(pkg.version || ""))) fail(`version 不是 semver：${pkg.version}`);
if (!pkg.dshTarget) fail("缺 dshTarget（宿主版本闸门靠它）");
if (!/^(>=|\^|~)?\s*\d+\.\d+/.test(String(pkg.dshTarget || ""))) {
  fail(`dshTarget 不是可解析的版本范围：${pkg.dshTarget}`);
}
if (!pkg.engines || !/22\.5|23|24|>=\s*2[2-9]/.test(String(pkg.engines.node || ""))) {
  fail(`engines.node 必须体现 node:sqlite 的下限（>=22.5），现在是 ${pkg.engines && pkg.engines.node}`);
}

/* ---- 入口文件 ---- */
for (const rel of ["lib/index.js", "client.js", "cordis.patch.yml", "bin/dsh-purge.js"]) {
  if (!fs.existsSync(path.join(ROOT, rel))) fail(`缺文件：${rel}`);
}
if (!pkg.bin || Object.keys(pkg.bin).length === 0) {
  fail("package.json 没有 bin");
} else {
  for (const [name, rel] of Object.entries(pkg.bin)) {
    if (!fs.existsSync(path.join(ROOT, rel))) fail(`bin ${name} 指向不存在的文件：${rel}`);
  }
}

/* ---- files 声明与实际 ---- */
const filesField = Array.isArray(pkg.files) ? pkg.files : [];
if (filesField.length === 0) fail("files 为空，会把整个仓库塞进包里");
for (const entry of filesField) {
  if (entry.startsWith("!")) continue;
  if (!fs.existsSync(path.join(ROOT, entry))) notes.push(`files 里有不存在的条目（安装时会被忽略）：${entry}`);
}
for (const required of ["lib", "bin", "client.js", "cordis.patch.yml"]) {
  if (!filesField.includes(required)) fail(`files 里缺 ${required}`);
}

/* ---- 仓库地址一致性 ---- */
function ownerRepo(url) {
  const m = String(url || "").match(/github\.com[/:]+([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?(?:[/#?].*)?$/i);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : "";
}
const repo = ownerRepo(pkg.repository && pkg.repository.url);
const home = ownerRepo(pkg.homepage);
const bugs = ownerRepo(pkg.bugs && pkg.bugs.url);
const install = pkg.dsh && pkg.dsh.install ? pkg.dsh.install : {};
const installRepo = ownerRepo(install.git) || ownerRepo(install.tarball) || ownerRepo(install.zip);
if (!repo) fail("repository.url 指向的不是 GitHub 仓库");
for (const [label, value] of [["homepage", home], ["bugs", bugs], ["dsh.install", installRepo]]) {
  if (value && value !== repo) fail(`${label} 指向 ${value}，与 repository ${repo} 不一致`);
}

/* ---- 旧作者标识不许回流 ---- */
const FORBIDDEN = [
  { needle: "ZXEB", why: "旧仓库所有者" },
  { needle: "YuJunZhiXue", why: "旧仓库所有者" },
  { needle: "Copyright (c) 2026 小杨", why: "旧版权行" },
];
const SKIP_DIRS = new Set(["node_modules", ".git"]);
const SELF = path.join(ROOT, "scripts", "check-package.mjs"); // 本文件要列出这些词，跳过自身
const TEXT_EXT = new Set([".js", ".mjs", ".json", ".yml", ".yaml", ".md", ".sh", ".txt", ""]);

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const fp = path.join(dir, name);
    const st = fs.statSync(fp);
    if (st.isDirectory()) walk(fp, out);
    else if (TEXT_EXT.has(path.extname(name)) && st.size < 2 * 1024 * 1024) out.push(fp);
  }
  return out;
}

const offenders = [];
for (const fp of walk(ROOT)) {
  if (fp === SELF) continue;
  let text;
  try {
    text = fs.readFileSync(fp, "utf8");
  } catch {
    continue;
  }
  for (const { needle, why } of FORBIDDEN) {
    if (text.includes(needle)) offenders.push(`${path.relative(ROOT, fp)} 含 ${needle}（${why}）`);
  }
}
for (const o of offenders) fail(o);

/* ---- 输出 ---- */
for (const n of notes) console.log(`  · ${n}`);
if (problems.length > 0) {
  console.error(`包形状检查失败 / package shape failed (${problems.length}):`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log(`包形状检查通过 / package shape ok：${pkg.name}@${pkg.version} dshTarget=${pkg.dshTarget} repo=${repo}`);
