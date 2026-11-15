/**
 * 市场索引（format 1）自检。
 *
 * 规则抄自宿主 `@deepseek-ai/dsh-plugin-market-index` 的 parseMarketIndex，
 * 但**不依赖宿主包**：CI 里没有 asar 可读，字段规则写死在这里。
 * 额外做两件宿主校验器做不到的事（它明确不管内容一致性）：
 *   · 索引里的 version 必须和 package.json 一致
 *   · git 源的 commit 必须真的存在，且该 commit 里的包名/版本与索引一致
 *
 * 用法：node scripts/check-market-index.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INDEX_PATH = path.join(ROOT, "market", "index.json");
const problems = [];

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const COMMIT = /^[0-9a-f]{40}$/;
const HTTP_URL = /^https?:\/\/[^\s]+$/;

function fail(where, reason) {
  problems.push(`${where}: ${reason}`);
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** 字符串或 { lang: string }，且必须含 en。 */
function checkLocalized(value, where) {
  if (typeof value === "string") {
    if (value.trim() === "") fail(where, "不能是空字符串");
    return;
  }
  if (!isPlainObject(value)) return fail(where, "必须是字符串或语言映射");
  for (const [lang, text] of Object.entries(value)) {
    if (!/^[a-z]{2,3}(?:-[a-z0-9]+)*$/.test(lang)) fail(`${where}.${lang}`, "语言 id 必须小写");
    if (typeof text !== "string" || text.trim() === "") fail(`${where}.${lang}`, "必须是非空字符串");
  }
  if (!Object.hasOwn(value, "en")) fail(where, "必须含 en");
}

function cmpVersion(a, b) {
  const pa = a.split("-")[0].split(".").map(Number);
  const pb = b.split("-")[0].split(".").map(Number);
  for (let i = 0; i < 3; i += 1) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  const preA = a.includes("-");
  const preB = b.includes("-");
  if (preA !== preB) return preA ? -1 : 1;
  return String(a).localeCompare(String(b));
}

if (!fs.existsSync(INDEX_PATH)) {
  console.error(`找不到 ${path.relative(ROOT, INDEX_PATH)}`);
  process.exit(1);
}

let index;
try {
  index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
} catch (e) {
  console.error(`market/index.json 解析失败: ${e.message}`);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

/* ---- 顶层 ---- */
if (index.format !== 1) fail("$.format", `必须是 1，现在是 ${JSON.stringify(index.format)}`);
checkLocalized(index.title, "$.title");
if (index.description !== undefined) checkLocalized(index.description, "$.description");
if (!Array.isArray(index.plugins) || index.plugins.length === 0) {
  fail("$.plugins", "必须是非空数组");
}

const names = new Set();
for (const [i, plugin] of (index.plugins || []).entries()) {
  const at = `$.plugins[${i}]`;
  if (!isPlainObject(plugin)) {
    fail(at, "必须是对象");
    continue;
  }
  if (typeof plugin.name !== "string" || plugin.name.trim() === "") fail(`${at}.name`, "必须是非空字符串");
  if (names.has(plugin.name)) fail(`${at}.name`, `重复的包名 ${plugin.name}`);
  names.add(plugin.name);
  if (plugin.title !== undefined) checkLocalized(plugin.title, `${at}.title`);
  if (plugin.description !== undefined) checkLocalized(plugin.description, `${at}.description`);
  if (plugin.homepage !== undefined && !HTTP_URL.test(String(plugin.homepage))) {
    fail(`${at}.homepage`, "必须是绝对 http(s) URL");
  }
  if (plugin.repository !== undefined) {
    if (!isPlainObject(plugin.repository) || !HTTP_URL.test(String(plugin.repository.url))) {
      fail(`${at}.repository.url`, "必须是绝对 http(s) URL");
    }
    const repoUrl = String(plugin.repository.url || "");
    if (/[?#]/.test(repoUrl)) fail(`${at}.repository.url`, "不能带 query 或 fragment");
    if (plugin.repository.directory !== undefined && String(plugin.repository.directory).startsWith("/")) {
      fail(`${at}.repository.directory`, "必须是相对 POSIX 目录");
    }
  }
  if (!Array.isArray(plugin.versions) || plugin.versions.length === 0) {
    fail(`${at}.versions`, "必须是非空数组");
    continue;
  }

  const seenVersions = new Set();
  let prev = null;
  for (const [j, version] of plugin.versions.entries()) {
    const vat = `${at}.versions[${j}]`;
    if (!isPlainObject(version)) {
      fail(vat, "必须是对象");
      continue;
    }
    const ver = String(version.version || "");
    if (!SEMVER.test(ver)) fail(`${vat}.version`, `不是精确 semver：${ver || "(空)"}`);
    if (seenVersions.has(ver)) fail(`${vat}.version`, `版本重复：${ver}`);
    seenVersions.add(ver);
    if (prev !== null && cmpVersion(prev, ver) <= 0) {
      fail(`${vat}.version`, `版本必须按 semver 降序排列（${prev} 在 ${ver} 之前）`);
    }
    prev = ver;

    if (!Number.isInteger(version.publishTimestamp) || version.publishTimestamp <= 0) {
      fail(`${vat}.publishTimestamp`, "必须是正整数（Unix 秒）");
    }

    const source = version.source;
    if (!isPlainObject(source)) {
      fail(`${vat}.source`, "必须是对象");
    } else if (source.type === "npm") {
      if (source.registry !== undefined && !HTTP_URL.test(String(source.registry))) {
        fail(`${vat}.source.registry`, "必须是绝对 http(s) URL");
      }
    } else if (source.type === "git") {
      if (!HTTP_URL.test(String(source.url || "")) || /[?#]/.test(String(source.url || ""))) {
        fail(`${vat}.source.url`, "必须是干净的绝对 https URL（不带 query/fragment）");
      }
      if (!COMMIT.test(String(source.commit || ""))) {
        fail(`${vat}.source.commit`, "必须是 40 位小写十六进制 commit");
      }
      if (source.path !== undefined && String(source.path).startsWith("/")) {
        fail(`${vat}.source.path`, "必须是相对 POSIX 目录");
      }
    } else {
      fail(`${vat}.source.type`, "只支持 npm 或 git");
    }

    if (version.engines !== undefined) {
      if (!isPlainObject(version.engines)) fail(`${vat}.engines`, "必须是对象");
      else if (version.engines.dsh !== undefined && typeof version.engines.dsh !== "string") {
        fail(`${vat}.engines.dsh`, "必须是字符串形式的 semver 范围");
      }
    }

    /* ---- 内容一致性（宿主校验器不管这一层）---- */
    if (plugin.name === pkg.name && ver !== pkg.version) {
      fail(`${vat}.version`, `索引写 ${ver}，package.json 是 ${pkg.version}`);
    }
  }
}

/* ---- git 源指向的提交必须真实存在 ---- */
const gitOk = fs.existsSync(path.join(ROOT, ".git"));
if (gitOk) {
  for (const plugin of index.plugins || []) {
    for (const version of plugin.versions || []) {
      const source = version.source || {};
      if (source.type !== "git" || !COMMIT.test(String(source.commit || ""))) continue;
      try {
        execFileSync("git", ["cat-file", "-e", `${source.commit}^{commit}`], { cwd: ROOT, stdio: "pipe" });
      } catch {
        fail(`$.plugins[${plugin.name}].versions[${version.version}].source.commit`, `提交 ${source.commit} 在仓库里不存在`);
        continue;
      }
      try {
        const raw = execFileSync("git", ["show", `${source.commit}:package.json`], { cwd: ROOT, stdio: "pipe" }).toString("utf8");
        const committed = JSON.parse(raw);
        if (committed.name !== plugin.name) {
          fail(`$.plugins[${plugin.name}].source.commit`, `该提交里的包名是 ${committed.name}`);
        }
        if (committed.version !== version.version) {
          fail(`$.plugins[${plugin.name}].source.commit`, `该提交里的版本是 ${committed.version}，索引写 ${version.version}`);
        }
      } catch {
        fail(`$.plugins[${plugin.name}].source.commit`, "读不出该提交里的 package.json");
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`市场索引自检失败 / market index check failed (${problems.length}):`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
const total = (index.plugins || []).reduce((n, p) => n + (p.versions || []).length, 0);
console.log(`市场索引自检通过 / market index ok: ${index.plugins.length} 个插件，${total} 个版本${gitOk ? "，git 提交已核对" : ""}`);
