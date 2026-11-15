# dsh-purge

DeepSeek Harness 破甲 / 红队评测插件。不改模型，改的是宿主层：提示词注入、审批闸门、沙箱策略、会话迁移都在运行时可重写，所以「模型不答」很多时候是宿主层拦的，不是模型拒绝。

内置演练台（预设 + 技能 + 事实库），也可只用清洗功能。

## 环境要求

| 项 | 要求 |
|---|---|
| dsh | **>= 0.2.2**（本包 `dshTarget` 为 `>=0.2.2`；低于此版本会显示版本不匹配或跳过） |
| Node.js | >= 18 |
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
dsh-purge --status       # 宿主、DSH_HOME、补丁 applied/pending、shim、备份
dsh-purge --apply        # 应用全部补丁（提示词 + 代码 + shim + override）
dsh-purge --revert       # 回滚还原
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
scripts/             构建与工具脚本
client.js            面板前端（构建产物）
cordis.patch.yml     宿主挂载补丁
```

运行时文件在 `$DSH_HOME`：`dsh-purge/`（状态与备份）、`redteam/`（事实库）、`prompt-inject.md`（注入提示词）。

## 更新 / 还原 / 卸载

```sh
dsh plugin --profile desktop update dsh-purge
# 然后完全退出宿主 → 重开 → 清洗 → 应用
```

面板里也有「更新 / 还原 / 卸载」。还原会按备份逐文件回退，卸载先还原再移除挂载。

## 兼容性

- dsh **>= 0.2.2**：支持官方 web 与桌面宿主。
- dsh 0.1.x：不支持，`dshTarget` 不匹配。
- Windows 需要 Git Bash（不支持 WSL 的 `System32\bash.exe`）。

## 许可

MIT，见 [LICENSE](LICENSE)。
