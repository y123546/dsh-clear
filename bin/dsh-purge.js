#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import * as core from "../lib/core.js";
import * as rules from "../lib/rules.js";

const args = process.argv.slice(2);
const force = args.includes("--force");

const MODES = ["--apply", "--revert", "--uninstall", "--status", "--edit", "--doctor", "--help"];

function printHelp() {
  console.log(`dsh-purge 用法 / Usage
  dsh-purge --status     显示状态 / show status
  dsh-purge --doctor     环境自检（node/sqlite/宿主版本/备份/补丁） / environment self-check
  dsh-purge --apply      应用全部清洗（提示词+代码+shim+override） / apply all
  dsh-purge --revert     回滚还原 / revert patches
  dsh-purge --revert --force   跳过完整性校验强制还原 / revert even if the host changed
  dsh-purge --uninstall  卸载插件（已应用则先还原） / uninstall
  dsh-purge --edit       编辑注入文件 prompt-inject.md / edit the inject file
  dsh-purge --help       帮助 / help`);
}

function compatLine(compat) {
  if (!compat) return "";
  if (compat.unknown) return `  版本闸门 / gate  ${compat.reason}`;
  if (compat.ok) return `  版本闸门 / gate  ✓ 宿主 ${compat.version} 满足 ${compat.range}`;
  return `  版本闸门 / gate  ⚠ ${compat.reason}`;
}

function printStatus(state) {
  const out = [];
  out.push("dsh-purge 状态 / Status");
  out.push("  宿主 / surface " + (state.surface || "web"));
  out.push("  DSH_HOME      " + state.dsh_home);
  if (state.desktop_install) out.push("  桌面安装       " + state.desktop_install);
  if (state.ai_base) {
    out.push("  插件根 / root  " + state.ai_base);
    for (const [key, fp] of Object.entries(state.files)) {
      out.push(`    ${key.padEnd(22)} ${fp}`);
    }
  } else {
    out.push("  插件根 / root  " + core.missingAiBaseMessage());
  }
  out.push(`  shim 目录      ${state.shim_dir || "未定位 / not found"}`);
  out.push(`  备份 / backup  ${state.has_backup ? "有 / yes" : "无 / no"}`);
  out.push(`  注入文件       ${state.override_path}`);
  out.push(`  注入状态       ${state.override_status}`);
  const gate = compatLine(state.host_compat);
  if (gate) out.push(gate);
  out.push("");
  out.push(`  补丁 ${state.patches_applied}/${core.ALL_PATCHES.length} 已清洗, ${state.patches_pending} 待清洗`);
  for (const p of core.ALL_PATCHES) {
    const s = state.patch_status[p.id];
    const mark = s === "applied" ? "✓" : s === "pending" ? "✗" : "·";
    out.push(`    ${mark} [#${String(p.id).padEnd(2)}] ${p.name.padEnd(30)} ${p.layer}/${p.layer_en} — ${s}`);
  }
  out.push("");
  out.push(`  shim: dsh.cmd=${state.shim_cmd}  dsh.ps1=${state.shim_ps1}  dsh=${state.shim_bin}`);
  return out.join("\n");
}

function countBackups(state) {
  let n = 0;
  const seen = new Set();
  const push = (dir) => {
    try {
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith(".dshpurge.bak")) continue;
        if (seen.has(name)) continue;
        seen.add(name);
        n += 1;
      }
    } catch {
      /* 目录不存在 */
    }
  };
  for (const fp of core.flattenTargetPaths(state.files || {})) push(path.dirname(fp));
  try {
    const shimBak = path.join(state.dsh_home, "dsh-purge", "shim-backups");
    for (const name of fs.readdirSync(shimBak)) if (name.endsWith(".bak")) n += 1;
  } catch {
    /* 没有 shim 备份 */
  }
  return n;
}

function yamlAvailable(aiBase) {
  const tries = [aiBase, path.join(aiBase || "", "dsh"), process.cwd()].filter(Boolean);
  for (const base of tries) {
    try {
      const req = createRequire(path.join(base, "noop.js"));
      req.resolve("yaml");
      return { ok: true, from: base };
    } catch {
      /* 下一个 */
    }
  }
  return { ok: false, from: "" };
}

async function printDoctor(state) {
  const { sqliteStatus } = await import("../lib/redteam/schema.js");
  const sqlite = sqliteStatus();
  const own = (() => {
    try {
      return JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    } catch {
      return {};
    }
  })();
  const backups = countBackups(state);
  const manifest = (() => {
    try {
      const fp = path.join(state.dsh_home, "dsh-purge", "backup-manifest.json");
      return JSON.parse(fs.readFileSync(fp, "utf8"));
    } catch {
      return null;
    }
  })();
  const yaml = yamlAvailable(state.ai_base);
  const compat = state.host_compat || {};

  const out = [];
  out.push("dsh-purge 自检 / Doctor");
  out.push(`  node            ${process.version}${sqlite.ok ? "" : "   (需要 >= 22.5)"}`);
  out.push(`  sqlite          ${sqlite.ok ? "✓ 可用 / available" : "✗ " + sqlite.reason}`);
  out.push(`  本包 / package  ${own.name || "dsh-purge"}@${own.version || "?"}   dshTarget=${own.dshTarget || "(未声明)"}`);
  out.push(`  宿主版本        ${compat.version || "读不到 / unknown"}`);
  if (!compat.unknown) {
    out.push(`  版本兼容        ${compat.ok ? "✓ 满足 / ok" : "✗ " + compat.reason}`);
  } else if (compat.reason) {
    out.push(`  版本兼容        · ${compat.reason}`);
  }
  out.push(`  插件根 / root   ${state.ai_base || core.missingAiBaseMessage()}`);
  out.push(`  yaml 依赖       ${yaml.ok ? "✓ " + yaml.from : "✗ 宿主没解析到 yaml（部分补丁会 pending）"}`);
  out.push(`  备份 / backup   ${backups} 个 .bak`);
  out.push(`  备份清单        ${manifest ? `${Object.keys(manifest.files || {}).length} 个文件已记账，宿主 ${manifest.hostVersion || "未知"}` : "无（老备份，还原走保守判定）"}`);
  out.push(`  补丁            applied=${state.patches_applied} pending=${state.patches_pending} skipped=${state.patches_skipped}`);
  out.push(`  shim            dsh.cmd=${state.shim_cmd} dsh.ps1=${state.shim_ps1} dsh=${state.shim_bin}`);
  out.push(`  asar 密封       ${state.asar_still_sealed ? "是 / sealed（桌面宿主还没解包）" : "否 / unpacked"}`);
  out.push(`  hooks 拒绝旁路  ${state.hooks_deny_bypass ? "开启 / on" : "关闭 / off"}`);
  out.push("");
  out.push(!state.ai_base
    ? "结论：没定位到宿主，先确认 DSH_BASE 或直接在宿主环境里运行 / host not located"
    : state.patches_pending > 0
      ? "结论：有补丁未生效，先在面板点「应用」或执行 --apply / some patches are pending"
      : "结论：补丁已齐 / all patches settled");
  return out.join("\n");
}

async function main() {
  const mode = args.find((a) => MODES.includes(a));

  if (mode === "--help" || args.includes("-h")) {
    printHelp();
    return;
  }

  const state = await core.gatherState();

  if (mode === "--doctor") {
    console.log(await printDoctor(state));
    return;
  }

  console.log(printStatus(state));
  console.log("");

  if (mode === "--apply") {
    if (!state.ai_base) {
      console.log("[ERROR] " + core.missingAiBaseMessage());
      console.log("  fix: 把 DSH_BASE 指到含 dsh-agent-instructions/lib 的 @deepseek-ai 目录");
      process.exit(1);
    }
    if (state.host_compat && state.host_compat.ok === false) {
      console.log("  ⚠ " + state.host_compat.reason);
      console.log("  ⚠ 继续执行，匹配不上的补丁会保持 pending / continuing; unmatched patches stay pending");
    }
    const inject = rules.resolveInjectText(state.dsh_home);
    if (!inject.text) {
      console.log("[ERROR] 提示词和规则集都是空的，必须先添加提示词");
      console.log("[ERROR] prompt and rule set are both empty; add a prompt first");
      process.exit(1);
    }
    const { hosts, report, failures } = await core.applyPatchesAllHosts(core.ALL_PATCHES, {
      preserveClientBundles: false,
      forApply: true,
    });
    for (const f of failures || []) {
      console.log(`  ✗ 宿主处理失败 / host failed: ${f.aiBase}`);
      console.log(`    ${f.error}`);
      console.log(`    已回滚 / rolledBack=${f.rolledBack ? "yes" : "no（需手动还原）"}`);
    }
    for (const h of hosts) console.log(`  宿主 / host → ${h.aiBase}`);
    for (const r of report) {
      const m = r.status === "applied" ? "✓ 已清洗" : r.status === "already" ? "- 已是最新" : r.status === "missing_file" ? "⚠ 文件缺失" : `✗ ${r.status}`;
      console.log(`  ${m} patch #${String(r.patch_id).padEnd(2)} ${r.name}`);
    }
    const flashHost = hosts[0]?.aiBase || state.ai_base;
    const flash = core.silenceCmdFlash(flashHost);
    console.log(`  cmd-flash=${flash.entry} phase-1=${flash.phase1} ok=${flash.ok}`);
    if (hosts.length > 1) {
      console.log(`  多宿主 / multi-host: ${hosts.length} 份 @deepseek-ai 已清洗`);
    }
    console.log(inject.source === "rule"
      ? "  - 使用当前规则集，不改写提示词文件 / using rule set"
      : "  - 使用已有提示词文件 / using existing prompt file");
    if (state.shim_dir) {
      const r = await core.patchShim(state.shim_dir);
      for (const [fname, st] of Object.entries(r)) {
        if (st === "patched") console.log(`  ✓ shim ${fname} 注入 / injected`);
        else if (st === "already_patched") console.log(`  - shim ${fname} 已注入 / already injected`);
        else if (st === "missing") console.log(`  - shim ${fname} 不存在 / missing`);
        else console.log(`  ⚠ shim ${fname}: ${st}`);
      }
    } else {
      console.log("  ⚠ 未定位 shim 目录，跳过注入 / shim dir not found, skipped");
    }
    console.log("");
    console.log("全部完成 / All done。重启 dsh 生效 / Restart dsh to take effect.");
  } else if (mode === "--revert") {
    if (state.ai_base || core.enumeratePatchAiBases().length) {
      const { reverted, errors, conflicts, upgraded } = await core.revertAllHosts({ force });
      for (const p of reverted) console.log(`  ✓ 已还原 / Reverted ${p}`);
      for (const [p, e] of errors) console.log(`  ⚠ 还原失败 / failed ${p}: ${e}`);
      for (const c of conflicts) {
        console.log(`  ⛔ 跳过 / skipped ${c.path}`);
        console.log(`     原因 / reason: ${c.reason}`);
      }
      if (conflicts.length > 0) {
        console.log("");
        console.log("  这些文件在打完补丁后被宿主升级或人为改过，用旧备份盖回去等于降级，已拒绝。");
        console.log("  These files changed after patching; restoring the old backup would downgrade the host.");
        console.log("  真的要用旧备份覆盖，加 --force / use --force to override anyway.");
      }
      if (upgraded.length > 0) {
        console.log(`  ⚠ 检测到宿主升级 / host upgraded: ${upgraded.join(", ")}`);
        console.log("    建议不还原，直接重装官方宿主后再按需重新应用 / prefer reinstalling the host");
      }
      if (reverted.length === 0 && conflicts.length === 0) console.log("  - 没有补丁备份可还原 / no patch backup");
    }
    if (state.shim_dir) {
      const r = await core.revertShim(state.shim_dir);
      for (const [fname, st] of Object.entries(r)) {
        if (st === "reverted" || st === "stripped_inject") console.log(`  ✓ shim ${fname}: ${st}`);
        else console.log(`  - shim ${fname}: ${st}`);
      }
    }
    console.log("");
    console.log("回滚完成 / Revert done。重启 dsh 后恢复 / restart to restore.");
    console.log("注: prompt-inject.md 保留（用户文件）/ prompt-inject.md kept (user file)");
  } else if (mode === "--uninstall") {
    const { uninstallPurge } = await import("../lib/uninstall.js");
    const result = await uninstallPurge();
    if (result.applied) console.log("  已检测到补丁，已还原回原版。 / patches detected and reverted");
    else console.log("  未检测到已应用补丁，仍会清除插件文件。 / no applied patch detected, files removed anyway");
    if (result.override?.removed) console.log(`  已删除 / removed ${result.override.path}`);
    if (result.stripped?.length) console.log(`  已从 profile 移除 / stripped: ${result.stripped.join(", ")}`);
    for (const e of result.errors || []) console.log(`  ⚠ ${e}`);
    if (!result.ok) {
      console.log("  卸载中止：还原失败，插件文件未删除。 / aborted: revert failed");
      process.exit(1);
    }
    console.log("");
    console.log("卸载完成。请重启 dsh。 / Uninstall done, restart dsh.");
  } else if (mode === "--edit") {
    const r = core.editOverride(state.dsh_home);
    if (!r.ok && r.needCreate) {
      await core.installOverride(state.dsh_home, true);
      console.log(`  ✓ 已创建默认注入文件 / created: ${state.override_path}`);
      core.editOverride(state.dsh_home);
    } else {
      console.log(`  → 已打开 ${r.editor} 编辑注入文件 / edit: ${r.path}`);
    }
    console.log("  编辑完成后重启 dsh 生效。 / restart dsh after editing");
  } else {
    console.log("默认不清洗，使用 --apply 应用清洗。 / nothing applied; use --apply");
  }
}

main().catch((e) => {
  console.error("[dsh-purge] error:", e);
  process.exit(1);
});
