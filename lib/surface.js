import path from "node:path";
import fs from "node:fs";

/** 当前已接线的宿主面。gui / tui 先能识别，适配仍回退 web。 */
export const SURFACES = Object.freeze(["web", "desktop", "gui", "tui"]);

function norm(value) {
  return String(value || "").trim().toLowerCase();
}

function slash(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}

function exeName(execPath) {
  return path.basename(String(execPath || "")).toLowerCase();
}

export function pathLooksDesktop(p) {
  const n = slash(p);
  if (!n) return false;
  // 安装目录可能叫 "DeepSeek Harness" / "deepseek-harness" / "DeepseekHarnessDesktop"。
  // 源码仓库也常带 deepseek-harness 名字，所以还要带 resources/、exe、.app/ 才算桌面安装。
  const harnessDir =
    n.includes("/deepseek harness/") ||
    n.includes("/deepseek-harness/") ||
    n.includes("/deepseekharness") ||
    /\/deepseek[\s._-]*harness/.test(n);
  return (
    n.includes("/dsh desktop/") ||
    n.includes("/dsh desktop.app/") ||
    n.includes("dsh-desktop") ||
    n.includes("dsh-plugin-desktop") ||
    n.includes("/deepseek harness.app/") ||
    (harnessDir && (n.includes("/resources/") || n.includes("/contents/resources/") || n.endsWith("/resources"))) ||
    /\/dsh desktop\.exe$/i.test(n) ||
    /\/deepseek[\s._-]*harness\.exe$/i.test(n) ||
    n.endsWith("/host-process-entry.js") ||
    n.endsWith("/desktop-cli.js")
  );
}

function resourcesLookLikeDesktopInstall(resourcesPath) {
  if (!resourcesPath) return false;
  if (pathLooksDesktop(resourcesPath)) return true;
  const n = slash(resourcesPath);
  if (!(n.endsWith("/resources") || n.includes("/contents/resources"))) return false;
  try {
    const asar = path.join(resourcesPath, "app.asar");
    if (fs.existsSync(asar) && fs.statSync(asar).isFile()) return true;
    if (fs.existsSync(path.join(resourcesPath, "app", "dsh"))) return true;
    if (fs.existsSync(path.join(resourcesPath, "app.asar.unpacked", "dsh"))) return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function isDesktopSurface(input = {}) {
  const env = input.env ?? process.env;
  const forced = norm(env.DSH_SURFACE);
  if (forced === "desktop") return true;
  if (forced && SURFACES.includes(forced)) return false;

  const execPath = input.execPath ?? process.execPath;
  const name = exeName(execPath);
  if (
    name === "dsh desktop.exe" ||
    name === "dsh desktop" ||
    name === "deepseek harness.exe" ||
    name === "deepseek-harness.exe" ||
    name === "deepseek harness" ||
    name === "deepseek-harness" ||
    /^deepseek[\s._-]*harness(\.exe)?$/.test(name)
  ) return true;
  if (pathLooksDesktop(execPath)) return true;

  const resourcesPath = input.resourcesPath ?? process.resourcesPath;
  if (resourcesLookLikeDesktopInstall(resourcesPath)) return true;

  const argv = input.argv ?? process.argv;
  if ((Array.isArray(argv) ? argv : []).some((arg) => pathLooksDesktop(arg))) return true;

  const parentPort = input.parentPort !== undefined ? input.parentPort : process.parentPort;
  if (parentPort && (pathLooksDesktop(execPath) || resourcesLookLikeDesktopInstall(resourcesPath))) return true;

  if (env.ELECTRON_RUN_AS_NODE && (pathLooksDesktop(execPath) || resourcesLookLikeDesktopInstall(resourcesPath))) return true;
  return false;
}

function forcedSurface(env) {
  const forced = norm(env.DSH_SURFACE);
  return SURFACES.includes(forced) ? forced : "";
}

export function detectSurface(input = {}) {
  const env = input.env ?? process.env;
  const forced = forcedSurface(env);
  if (forced) return forced;
  if (isDesktopSurface(input)) return "desktop";
  return "web";
}

/** gui / tui 尚未单独适配，先走 web 重启与探测。 */
export function adapterFor(kind) {
  return kind === "desktop" ? "desktop" : "web";
}

/* ------------------------------------------------------------------ dsh-Go 手机引擎 */

/**
 * 识别 dsh-Go 的手机本机引擎。
 *
 * 它跑的是真 DSH（Ubuntu + PRoot），所以插件照常加载；但有两个差别必须让插件知道：
 *   · 引擎由 App 托管，插件自己 spawn 重启会把 App 的引擎进程搞丢；
 *   · 引擎在构建期被 dsh-Go 自己 patch 过，宿主文件基线与我们不同。
 *
 * 判定用"环境证据"而不是写死平台：PRoot 会带 PROOT_* 变量，
 * 引擎固定装在 /opt/dsh（见其 runtime/lib/rtbuild.py 的 add_tree(..., "opt/dsh", ...)）。
 * 任一命中即认为是 dsh-Go 宿主；普通 Linux 服务器不会命中。
 */
const GO_ENGINE_ROOT = "/opt/dsh";
const GO_MARKERS = ["/opt/dsh/node_modules/@deepseek-ai", "/root/.dsh/dsh-go"];
const PROOT_ENV = ["PROOT_TMP_DIR", "PROOT_LOADER", "PROOT_NO_SECCOMP", "PROOT_L2S_DIR"];

let goCache;

export function goHostInfo(input = {}) {
  const explicit = input.env !== undefined || input.platform !== undefined;
  const env = input.env ?? process.env;
  const platform = input.platform ?? process.platform;
  /* 手动开关：DSH_PURGE_GO_HOST=1/0 强制认定/排除手机引擎。
     给"识别不准"和"自动化测试"留的出口；带开关时不吃缓存，每次都重算。 */
  const forced = String(env.DSH_PURGE_GO_HOST ?? "").trim();
  if (forced === "0") {
    return { isGo: false, reasons: ["env DSH_PURGE_GO_HOST=0"], engineRoot: GO_ENGINE_ROOT, managedRestart: false };
  }
  if (forced === "1") {
    return { isGo: true, reasons: ["env DSH_PURGE_GO_HOST=1"], engineRoot: GO_ENGINE_ROOT, managedRestart: true };
  }
  if (!explicit && goCache !== undefined) return goCache;
  const reasons = [];
  if (platform === "linux") {
    for (const key of PROOT_ENV) {
      if (String(env[key] || "").trim()) {
        reasons.push(`env ${key}`);
        break;
      }
    }
    for (const marker of GO_MARKERS) {
      try {
        if (fs.existsSync(marker)) reasons.push(marker);
      } catch {
        /* 无权限就当没有 */
      }
    }
  }
  const info = {
    isGo: reasons.length > 0,
    reasons,
    engineRoot: GO_ENGINE_ROOT,
    // 引擎由 App 托管：插件不自行重启，只提示在 App 里操作。
    managedRestart: reasons.length > 0,
  };
  if (!explicit) goCache = info;
  return info;
}

/** 人类可读的宿主环境名，给 --status / --doctor 用。 */
export function describeHostEnv(input = {}) {
  const go = goHostInfo(input);
  const surface = detectSurface(input);
  if (go.isGo) return `dsh-Go 手机引擎（${surface}）`;
  if (surface === "desktop") return "官方桌面宿主 / desktop";
  return `命令行或 Web 宿主（${surface}）`;
}
