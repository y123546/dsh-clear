/**
 * dsh-Go 原生视图的构造函数（纯函数，不碰文件系统）。
 *
 * 只做两件事：把清洗状态浓缩成三个数字 + 一句结论；把应用/还原结果压成一条提示条。
 * 组件只用 v1 的 stack / row / metric / text / callout —— 老 App 也认。
 */

/** 状态类里"点了也不会生效"的那几种，口径与 --doctor 的「补丁基线」一致。 */
const STALE_STATUSES = new Set(["skipped", "unmatched", "pattern_not_found"]);

function countStale(patchStatus) {
  let n = 0;
  for (const value of Object.values(patchStatus || {})) {
    if (STALE_STATUSES.has(String(value))) n += 1;
  }
  return n;
}

function clip(text, limit) {
  const s = String(text ?? "");
  return s.length > limit ? `${s.slice(0, limit)}…` : s;
}

/**
 * purge_status 的卡片。
 * @param state core.gatherState() 的返回值
 */
export function statusView(state = {}) {
  /* 两种入参都吃：工具返回的紧凑 data（applied/pending/total/stale），
     或 gatherState() 的原始结果（display_* / patches_* / patch_status 全量）。 */
  const applied = Number(state.applied ?? state.display_applied ?? state.patches_applied ?? 0);
  const pending = Number(state.pending ?? state.display_pending ?? state.patches_pending ?? 0);
  const total = Number(state.total ?? state.display_total ?? state.patches_total ?? 0);
  const stale = state.stale != null ? Number(state.stale) : countStale(state.patch_status);
  const env = String(state.host_env || state.surface || "web");

  const children = [
    {
      type: "row",
      children: [
        { type: "metric", label: "已生效", value: String(applied), tone: applied > 0 ? "good" : "info" },
        { type: "metric", label: "待应用", value: String(pending), tone: pending > 0 ? "warn" : "info" },
        { type: "metric", label: "未匹配", value: String(stale), tone: stale > 0 ? "bad" : "info" },
      ],
    },
    { type: "text", text: `宿主：${env}`, tone: "muted" },
  ];

  if (stale > 0) {
    children.push({
      type: "callout",
      tone: "warn",
      text: `${stale} 个补丁的原文在宿主里找不到，再点「应用」也不会生效。跑 dsh-purge --doctor 看是哪几条。`,
    });
  } else if (pending > 0) {
    children.push({
      type: "callout",
      tone: "info",
      text: `${pending} 个补丁待应用。点应用后需要重启宿主。`,
    });
  } else {
    children.push({
      type: "callout",
      tone: "good",
      text: total > 0 ? `补丁已齐（${applied}/${total}）。` : "还没定位到宿主，先设置 DSH_BASE。",
    });
  }

  return {
    type: "stack",
    title: `清洗 ${applied}/${total || "-"}`,
    children,
  };
}

/**
 * purge_apply / purge_revert 的卡片：一条提示条 + 截断的明细。
 * @param kind  "apply" | "revert"
 * @param value 工具返回值 `{ text, ok?, ... }`
 */
export function resultView(kind, value = {}) {
  const text = String(value?.text ?? "");
  const ok = value?.ok !== false;
  const title = kind === "revert" ? "还原" : "应用";
  const tone = ok ? "good" : "warn";
  const firstLine = text.split(String.fromCharCode(10)).map((x) => x.trim()).filter(Boolean)[0] || "";
  return {
    type: "stack",
    title: `${title}${ok ? "完成" : "未完成"}`,
    children: [
      { type: "callout", tone, text: clip(firstLine || `${title}已执行`, 120) },
      { type: "text", text: clip(text, 1200), tone: "muted" },
    ],
  };
}
