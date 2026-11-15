# dsh-purge

DeepSeek Harness 破甲 / 红队评测插件。不改模型，改的是宿主层：提示词注入、审批闸门、沙箱策略、会话迁移都在运行时可重写，所以「模型不答」很多时候是宿主层拦的，不是模型拒绝。

内置演练台（预设 + 技能 + 事实库），也可只用清洗功能。

## 环境要求

| 项 | 要求 |
|---|---|
| dsh | **>= 0.2.2**，**含同号预发布**（`dshTarget: >=0.2.2-0`，所以 `0.2.2-rc.1` 这类引擎也算满足；`0.2.1` 不行） |
| Node.js | **>= 22.5**（演练台事实库用内置 `node:sqlite`；低于 22.5 时插件仍能加载，但事实库不可用） |
| 宿主 | 官方 web 宿主或桌面宿主，二选一 |

## 安装

本包按包名从 npm 安装的方式已不可用，用下面的 tarball / 本地目录 / 手动三种方式。

### 方式 A：tarball

```sh
# Web 宿主
dsh plugin --profile web add https://github.com/y123546/dsh-clear/archive/refs/heads/main.tar.gz

# 桌面宿主（先完全退出桌面客户端）
dsh plugin --profile desktop add https://github.com/y123546/dsh-clear/archive/refs/heads/main.tar.gz
```

也可以在 profile 的 `package.json` 里加依赖后 `npm install`：

```json
"dsh-purge": "https://github.com/y123546/dsh-clear/archive/refs/heads/main.tar.gz"
```

`package.json` 的 `repository / homepage / bugs / dsh.install` 均指向本仓库，面板里的「检查更新」按此地址取包。

### 方式 B：本地目录

```sh
git clone https://github.com/y123546/dsh-clear.git "$DSH_HOME/plugins/dsh-purge"
dsh plugin --profile desktop add "$DSH_HOME/plugins/dsh-purge"
```

目录里必须能直接看到 `package.json`（即仓库根）。

### 方式 C：手动兜底

下载源码解压成 `$DSH_HOME/plugins/dsh-purge`，然后在 profile 的 `package.json` 加：

```json
"dependencies": { "dsh-purge": "file:../../plugins/dsh-purge" }
```

再 `npm install` 一次，或在 `cordis.patch.yml` 里按 `name: 'dsh-purge'` 挂载。

### 装完必做三步

1. **完全退出宿主**（托盘也要退），再重开。
2. 打开面板 → **清洗** 页 → 点一次 **应用**。
3. 看状态是否为 `applied`。未应用等于没装。

## 使用

```sh
dsh-purge --status       # 宿主、DSH_HOME、补丁 applied/pending、shim、备份、版本闸门
dsh-purge --doctor       # 环境自检：node/sqlite/宿主版本/yaml/备份/补丁
dsh-purge --apply        # 应用全部补丁（提示词 + 代码 + shim + override）
dsh-purge --apply --prompt-only  # 只应用提示词层（宿主基线被改过时用）
dsh-purge --revert       # 回滚还原（带完整性闸门）
dsh-purge --revert --force  # 跳过完整性校验强制还原
dsh-purge --uninstall    # 卸载（已应用则先还原）
dsh-purge --edit         # 编辑注入文件 prompt-inject.md
dsh-purge --help
```

聊天命令：

```
/purge status | apply | revert | uninstall | edit | help
/rules list | use <id> | create <id> | delete <id> | reset | help
/skills list | import <压缩包或文件夹> | create <id> [说明] | delete <id> | help
/rewind
```

模型工具：`purge_status`、`purge_apply`、`purge_revert`。

面板：**清洗** 页依次是补丁状态、提示词、自己的服务器、规则集、Skill；**演练台** 页首次进入需授权确认（读声明 → 等倒计时 → 滚到文末 → 勾三项）。

`/rewind` 与输入框旁的回退按钮：把已发送内容撤回输入框，并撤掉这一轮已发出的内容与已完成任务，改完重新发送即可。

## 配置

改 `$DSH_HOME/profiles/<web|desktop>/cordis.patch.yml` 里的 `dsh-purge` 条目，**重启宿主**生效：

```yaml
- insert:
    - id: dsh-purge
      name: 'dsh-purge'
      inject: [systemPrompt, tools]
      config:
        enabled: true                 # 插件总开关
        autoApplyOnStart: false       # 启动时自动应用补丁
        autoUpdateOnStart: false      # 启动时检查更新
        autoRevertOnMissing: false    # 保留字段
        injectOnce: false             # 保留字段
        stripMnemon: true             # 去掉 mnemon 段
        verbose: false                # 控制台详细日志
        postPrompt: ""                # 额外提示段
        postPromptOrder: 5100         # 需大于内置全局顺序
        autoRetry: true               # 失败自动重试
        retryMax: 3
        autoContinue: false           # 自动续跑
        continueMax: 3
        continueText: "继续"
        capabilityProtocol: true      # 注入能力协议段
        hooksDenyBypass: true         # 跳过 hooks 拒绝拦截
    - id: dsh-purge-redteam
      name: dsh-purge/redteam
    - id: dsh-purge-redteam-store
      name: dsh-purge/redteam/store
      config:
        root: !!js dshHomePath('redteam')
    - id: dsh-purge-redteam-ui
      name: dsh-purge/redteam/ui
```

profile 层的 `cordis.patch.yml` 在内置配置之后加载，后续应用插件会保留你的 `insert`。

## 目录结构

```
lib/                 核心：补丁、宿主适配、规则、技能、更新
lib/redteam/         演练台：预设、事实库、HTTP 桥、评分
bin/dsh-purge.js     命令行入口
presets/redteam/     演练台预设
skills/redteam/      内置技能
scripts/             构建、检查与工具脚本
tests/               node:test 用例
market/              社区目录（awesome-dsh-plugin）投稿条目
client.js            面板前端（构建产物）
cordis.patch.yml     宿主挂载补丁
```

运行时文件在 `$DSH_HOME`：`dsh-purge/`（状态与备份）、`redteam/`（事实库）、`prompt-inject.md`（注入提示词）。

## 更新 / 还原 / 卸载

```sh
dsh plugin --profile desktop update dsh-purge
# 然后完全退出宿主 → 重开 → 清洗 → 应用
```

面板里也有「更新 / 还原 / 卸载」。卸载先还原再移除挂载。

**还原有完整性闸门。** 备份是打补丁前的原样，宿主一旦升级，这份原样就过期了。所以还原前会比对「打完补丁时记下的文件哈希」：

- 对得上 → 正常还原。
- 对不上（宿主升级 / 文件被人改过）→ **跳过并报冲突**，不会用旧文件把宿主降级。
- 确实要用旧备份覆盖 → `dsh-purge --revert --force`。宿主已被升级过的场景，更推荐重装官方宿主后按需重新应用，而不是强行还原。

## 自检

装完不确定哪里不对，先跑这个：

```sh
dsh-purge --doctor
```

输出包含：Node 版本与 `node:sqlite` 可用性、本包版本与 `dshTarget`、宿主真实版本与兼容结论、`yaml` 能否解析、备份数量与清单记录、补丁 applied/pending 统计、**补丁基线**、shim 三件套状态、asar 是否还密封、hooks 拒绝旁路开关。

**补丁基线**这一段专门区分两件容易混为一谈的事：

| 状态 | 含义 | 该怎么办 |
|---|---|---|
| ⏳ 待应用 | 原文在，只是还没点应用 | 点「应用」或 `--apply` |
| ⚠ 对不上 | 文件在，但补丁要替换的原文找不到，也没有本插件的标记 | 补丁基线不匹配，点了也不会生效 |

对不上通常是宿主被改过：版本不同，或宿主本身已经打过第三方补丁（例如 dsh-Go 构建期对同一批 `@deepseek-ai` 包套了 150 多个 `.diff`）。这一段会给出未命中的原文样例，方便判断是「版本不对」还是「别人改过」。

`--status` 也会带一行「版本闸门」，宿主版本落在 `dshTarget` 之外时会明确写出来，不再静默。

## 兼容性

- dsh **>= 0.2.2**（含 `0.2.2-rc.x`）：支持官方 web 与桌面宿主。
- dsh 0.1.x / 0.2.1：不支持，`dshTarget` 不匹配，`--doctor` 会直接标红。
- 已被第三方补丁改过的宿主（如 dsh-Go 的运行时）能装、能加载，但**补丁会大面积对不上**——`--doctor` 的「补丁基线」会写明哪些对不上。
- Windows 需要 Git Bash（不支持 WSL 的 `System32\bash.exe`）。
- Node **>= 22.5**：低于此版本插件能加载，但演练台事实库不可用（`--doctor` 会写明原因）。

## 装在手机里（dsh-Go）

先说清术语：dsh-Go 文档里的「本机引擎」指的是**手机自身**那套 DSH（Ubuntu + PRoot，引擎固定装在 `/opt/dsh`），不是你的电脑。要把插件装到手机上，就装进这个引擎里；**装的是同一个 `dsh-purge` 包**，不是另做一个手机版。

手机引擎和电脑上的宿主有两处不同，插件在运行时自己适配：

| 差别 | 插件怎么处理 |
|---|---|
| 引擎由 App 托管，插件 spawn 重启会把 App 手里的进程顶掉 | 检测到手机引擎就**不自行重启**，`/purge apply` 与 `--apply` 都只提示「去 App 的引擎页重启」 |
| 引擎在 App 构建期被 dsh-Go 自己 patch 过（`runtime/patches` 下 150+ 个 diff） | 代码补丁会大面积对不上；用 `--apply --prompt-only` 只打提示词层（25 个），这部分不依赖宿主源码原文 |

装法（App 内「终端」，命令执行在手机里，不是在电脑上）：

```sh
mkdir -p /root/.dsh/dsh-go/plugins && cd /root/.dsh/dsh-go/plugins
git clone https://github.com/y123546/dsh-clear.git dsh-purge
dsh plugin --profile web add /root/.dsh/dsh-go/plugins/dsh-purge
dsh-purge --doctor          # 先看「补丁基线」「运行环境」「dsh-go 桥接」三行
dsh-purge --apply --prompt-only   # 基线对不上时的推荐走法
```

- 环境行显示 `dsh-Go 手机引擎（web）` 即识别成功；识别不准或想强制，用 `DSH_PURGE_GO_HOST=1`（强制）/ `=0`（排除）。
- `dsh-go 桥接` 一行决定**原生面板会不会出现**：手机上由 App 自带；`✗ 没找到` 时面板和状态条不显示，但 `/purge` 命令、工具卡、演练台都不受影响。
- 手机上有原生面板：底部状态条显示 `62/82 已生效`，点开是「清洗」面板（三个指标 + 可点按钮 + 补丁行），见下一节。
- 引擎在 `/opt/dsh`，插件的 `findAiBase` 已把这一层作为候选，无需手配 `DSH_BASE`。

### 原生界面里能用什么

六样东西不用写 App 代码就原生显示，前四样本插件都接上了；面板与状态条另需 `package.json` 里的一小段 `dshGo` 清单（≤ 16 KiB，只声明位置，不含逻辑）：

| 在 App 里 | 现状 | 靠什么 |
|---|---|---|
| `/purge status`、`/rules`、`/skills`、`/rewind` | 输入框 `/` 菜单里能选，结果显示在对话里 | `ctx.commands.register` |
| `purge_status` / `purge_apply` / `purge_revert` | 工具行 + **原生卡片**（三个数字指标 / 结果提示条） | 工具 `presentationMeta` 里的 `dsh-go/view` |
| `skills/redteam/*` | App「技能」页原生列出 | `SKILL.md` |
| 底部状态条 `62/82 已生效` | 原生，点开进面板 | `composer.strip` + `ctx.dshGo.strip` |
| 「清洗」原生面板：三个指标、进度条、应用/还原/刷新/复制、补丁行 | 原生（对话详情「插件」页签 / 全部功能 / 聊天页插件弹层） | `panels` + `ctx.dshGo.panel` |
| 规则集编辑、Skill 导入、自己的服务器 | **不是原生**，走「网页版 / 网页岛」打开 | 那些是 web client 的表单 |

工具卡只多一个字段、不是清单声明，网页宿主完全不感知：网页上照旧显示文本结果，App 里才画成卡片。视图受两条硬约束，测试里已锁住——必须是可 JSON 序列化的普通对象，且序列化后 < 8 KiB，否则 App 会整张丢弃。

面板的按钮**不直接执行补丁**，而是返回 `{ command: { name: "purge", args: "apply" } }`：dsh-Go 给处理器的时限是 3 秒，而真正应用补丁要读写几十个文件，必然超时；转成斜杠命令由 App 在当前对话里执行，既不会超时，结果也留在对话里可追溯。

唯一没做的是插件配置的原生表单（App 的「设置 › 插件」里那种）：那需要导出 schemastery `Config`，本插件的配置项一直走 `cordis.patch.yml`，暂未提供。

## 安全默认值

装上即生效的两个默认值，改之前先知道后果：

| 默认 | 位置 | 含义 |
|---|---|---|
| `hooksDenyBypass: true` | `cordis.patch.yml` | 跳过宿主 hooks 的拒绝拦截 |
| `autoApplyOnStart: false` | 同上 | 启动不自动应用补丁，改动需手动点「应用」 |

插件会改写宿主安装目录里的 JS 文件（桌面版还会解开 `app.asar`），这是它工作的前提。升级链路目前有两道校验：下载只允许落在 GitHub / jsdelivr 白名单域名，解包后核对包名与版本。仍建议只在你能完全掌控的机器上使用。

## 开发

```sh
npm test          # node:test，覆盖版本闸门 / 补丁幂等 / sqlite 降级 / 更新 ref
npm run check     # 语法 + client.js 同步 + 包形状
npm run doctor    # 本机环境自检
npm run build:client   # 改完 lib/redteam/client.js 后重建 client.js
```

CI 在 Node 22.5 / 24 × Ubuntu / Windows 上跑语法、同步、单测与包形状检查。`client.js` 是构建产物，改了 `lib/redteam/client.js` 却忘记重建，`npm run check` 会直接失败。

## 许可

MIT，见 [LICENSE](LICENSE)。
