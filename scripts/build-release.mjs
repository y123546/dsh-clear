#!/usr/bin/env node
/**
 * 产出两个发布包：
 *   dist/dsh-purge-desktop.tgz  桌面 DSH（Windows / macOS / Linux）
 *   dist/dsh-purge-dshgo.tgz    手机 dsh-Go（Android，PRoot 引擎）
 *
 * 代码同源：插件运行时用 goHostInfo() 判断宿主，自动走对应分支。
 * 两个包的差别只有随包安装说明（INSTALL-*.md）与手机端的 install 脚本——
 * 这样既让用户一眼选对包，又不用维护两份会漂移的代码。
 */
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const dist = join(root, "dist");

/* 只复制运行必需的白名单，天然排除 .git / tests / market / node_modules */
const COPY = ["lib", "bin", "presets", "skills", "scripts", "client.js", "cordis.patch.yml", "README.md", "LICENSE", "package.json"];
const SKIP = [
  /(^|\/)node_modules(\/|$)/,
  /\.dshpurge\.bak$/,
  /(^|\/)default-prompt-inject\.md$/,
  /(^|\/)dist(\/|$)/,
];

function copyFilter(src) {
  const rel = relative(root, src).replace(/\\/g, "/");
  if (!rel) return true;
  return !SKIP.some((re) => re.test(rel));
}

function stageInto(stage) {
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  for (const item of COPY) {
    const src = join(root, item);
    if (!existsSync(src)) throw new Error(`缺少发布必需文件：${item}`);
    cpSync(src, join(stage, item), { recursive: true, filter: copyFilter });
  }
}

function tarGz(stageName, outName) {
  const out = join(dist, outName);
  rmSync(out, { force: true });
  /* 用系统 tar：CI 是 ubuntu，本地 Windows 也自带 tar。必须在 dist 里用相对
     路径调用——MSYS 的 tar 会把 "F:\..." 当成 rsh 远程主机（Cannot connect to F:）。 */
  execFileSync("tar", ["-czf", outName, "-C", stageName, "."], { cwd: dist, stdio: "inherit" });
  return out;
}

const desktopInstall = `# dsh-purge · 桌面版安装

适用：DeepSeek Harness 桌面客户端 / 官方 web 宿主（Windows、macOS、Linux）。

版本：${pkg.version}

## 1. 安装（三选一）

### A. 用本包直接装（推荐）

\`\`\`sh
# Web 宿主
dsh plugin --profile web add <本包绝对路径>/dsh-purge-desktop.tgz

# 桌面客户端（先完全退出客户端，托盘也要退）
dsh plugin --profile desktop add <本包绝对路径>/dsh-purge-desktop.tgz
\`\`\`

### B. 解压成插件目录

\`\`\`sh
mkdir -p "$DSH_HOME/plugins/dsh-purge"
tar -xzf dsh-purge-desktop.tgz -C "$DSH_HOME/plugins/dsh-purge"
dsh plugin --profile desktop add "$DSH_HOME/plugins/dsh-purge"
\`\`\`

### C. profile 依赖

在 profile 的 \`package.json\` 里加一条，再 \`npm install\`：

\`\`\`json
"dependencies": { "dsh-purge": "file:../../plugins/dsh-purge" }
\`\`\`

## 2. 装完必做三步

1. **完全退出宿主**（托盘也退），再重开。
2. 面板 → **清洗** → 点一次 **应用**。
3. 状态变成 \`applied\` 才算装好；未应用等于没装。

## 3. 桌面版能用的东西

- 清洗：提示词 / 审批 / 沙箱补丁
- 演练台：红队预设 + 技能库 + SQLite 事实库
- 桌面 shim：\`dsh.cmd\` / \`dsh.ps1\` / \`dsh\`

配置与用法见包内 \`README.md\`。
`;

const dshgoInstall = `# dsh-purge · 手机 dsh-Go 安装

适用：Android 上的 dsh-Go。引擎在 \`/opt/dsh\`，插件目录
\`/root/.dsh/dsh-go/plugins/dsh-purge\`。

版本：${pkg.version}

## 1. 安装

### A. 用随包脚本（推荐）

把本包解压到任意目录（例如 \`/sdcard/dsh-purge\`），然后：

\`\`\`sh
cd /sdcard/dsh-purge
sh install-dshgo.sh
\`\`\`

脚本会把包覆盖到插件目录；默认目标 \`/root/.dsh/dsh-go/plugins/dsh-purge\`，
可用 \`DSH_PLUGIN_DIR=/别的/路径\` 覆盖。

### B. 手动解压

\`\`\`sh
mkdir -p /root/.dsh/dsh-go/plugins/dsh-purge
tar -xzf dsh-purge-dshgo.tgz -C /root/.dsh/dsh-go/plugins/dsh-purge
\`\`\`

## 2. 装完必做三步

1. App → 侧边栏 → **本机引擎** → **重启**（或直接重开 App）。
2. 面板 → **清洗** → 点一次 **应用**。
3. 底部状态条应显示 \`71/71 已生效\`；若状态条没出现，去
   「插件 → 清洗 → 设置」把 **状态条** / **面板** 两个开关打开。

## 3. 手机版与桌面版的差别

同一份代码，插件启动时按宿主自动切换。手机上额外做了：

- 12 个补丁按 dsh-Go 宿主源码适配（\`lib/go-host-variants.js\`）
- 红队预设禁用 \`list-agents\`（宿主 0.2.2-rc.1 没有该子路径导出）
- 状态条 / 原生面板走 dsh-Go 的 composer 槽位

配置与用法见包内 \`README.md\`。
`;

const installDshgo = `#!/system/bin/sh
# dsh-Go 安装脚本：覆盖到插件目录，然后到「本机引擎」页重启。
# 用法：sh install-dshgo.sh
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
DEST="\${DSH_PLUGIN_DIR:-/root/.dsh/dsh-go/plugins/dsh-purge}"
mkdir -p "$DEST"
cp -a "$HERE"/. "$DEST"/
rm -f "$DEST/install-dshgo.sh"
echo "[dsh-purge] 已安装到 $DEST"
echo "[dsh-purge] 下一步：App → 侧边栏 → 本机引擎 → 重启（或重开 App）"
`;

mkdirSync(dist, { recursive: true });

const desktopStage = join(dist, ".stage-desktop");
stageInto(desktopStage);
writeFileSync(join(desktopStage, "INSTALL-desktop.md"), desktopInstall, "utf8");
const desktopPkg = tarGz(".stage-desktop", "dsh-purge-desktop.tgz");

const goStage = join(dist, ".stage-dshgo");
stageInto(goStage);
writeFileSync(join(goStage, "INSTALL-dshgo.md"), dshgoInstall, "utf8");
const scriptPath = join(goStage, "install-dshgo.sh");
writeFileSync(scriptPath, installDshgo, "utf8");
try { chmodSync(scriptPath, 0o755); } catch { /* Windows 上无执行位，tar 仍可解压后 sh 运行 */ }
const goPkg = tarGz(".stage-dshgo", "dsh-purge-dshgo.tgz");

for (const p of [desktopPkg, goPkg]) {
  console.log(`${p}  ${(statSync(p).size / 1024).toFixed(1)} KB`);
}
rmSync(desktopStage, { recursive: true, force: true });
rmSync(goStage, { recursive: true, force: true });
