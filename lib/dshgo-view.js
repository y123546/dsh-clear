/**
 * dsh-Go 原生面板的视图与数据（纯函数）。
 *
 * 约束来自 dsh-Go 的协议，两条都会导致"整块不显示"：
 *   · 数据每次必须给完整对象，单次 ≤ 32 KiB、≤ 4 Hz
 *   · 视图里的数字一律用绑定 `{ $: 'data.xxx' }`，不要每次重建结构
 * 所以这里只做两件事：把补丁状态压成语言无关的快照，再按 locale 出文案。
 */

const LAYER_EN = new Map([
  ["提示词", "Prompt"],
  ["代码", "Code"],
  ["工具", "Tools"],
  ["0.1.5 兼容", "0.1.5 compat"],
  ["0.2.0 兼容", "0.2.0 compat"],
]);

const WORDS = {
  zh: {
    panelTitle: "清洗",
    applied: "已生效",
    pending: "待应用",
    stale: "对不上",
    apply: "应用补丁",
    revert: "还原",
    refresh: "刷新",
    env: (v) => `宿主：${v}`,
    noteNoHost: "没定位到宿主。设 DSH_BASE 后重开。",
    noteStale: (n) => `${n} 个补丁的原文找不到，应用也不会生效。`,
    notePending: (n) => `${n} 个待应用，点「应用补丁」后需重启宿主。`,
    noteOk: "补丁已齐。",
    noteError: "读取状态失败。",
    more: (n) => `另有 ${n} 条已生效，未列出。`,
    stripNoHost: "未找到宿主",
    strip: (a, t) => `${a}/${t} 已生效`,
  },
  en: {
    panelTitle: "Purge",
    applied: "Applied",
    pending: "Pending",
    stale: "Mismatch",
    apply: "Apply",
    revert: "Revert",
    refresh: "Refresh",
    env: (v) => `Host: ${v}`,
    noteNoHost: "Host not found. Set DSH_BASE and relaunch.",
    noteStale: (n) => `${n} patches no longer match the host; applying will not help.`,
    notePending: (n) => `${n} pending. Tap Apply, then restart the host.`,
    noteOk: "All patches settled.",
    noteError: "Failed to read state.",
    more: (n) => `${n} more applied, not listed.`,
    stripNoHost: "No host",
    strip: (a, t) => `${a}/${t} applied`,
  },
};

/** zh 是默认；App 语言以 en 开头才用英文。 */
export function words(locale) {
  return typeof locale === "string" && locale.toLowerCase().startsWith("en") ? WORDS.en : WORDS.zh;
}

/** 可点按的行优先：对不上 > 待应用 > 已生效，最多 20 行。 */
export function pickRows(rows, limit = 20) {
  const rank = { skipped: 0, unmatched: 0, pattern_not_found: 0, pending: 1, applied: 2 };
  return [...(rows || [])]
    .sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3) || a.id - b.id)
    .slice(0, limit);
}

/**
 * 面板视图：结构固定，数字/文案全部走绑定。
 * @param {{sessionId?: string}} scope
 * @param {{locale?: string}} caps
 */
export function purgePanelView(scope, caps) {
  const t = words(caps && caps.locale);
  return {
    type: "stack",
    title: t.panelTitle,
    children: [
      {
        type: "row",
        children: [
          { type: "metric", label: t.applied, value: { $: "data.applied" }, tone: "good" },
          { type: "metric", label: t.pending, value: { $: "data.pending" }, tone: "warn" },
          { type: "metric", label: t.stale, value: { $: "data.stale" }, tone: "bad" },
        ],
      },
      { type: "text", text: { $: "data.env" }, tone: "muted" },
      { type: "callout", text: { $: "data.note" }, tone: { $: "data.tone" } },
      {
        type: "actions",
        items: [
          { label: t.apply, icon: "check", style: "primary", action: { id: "apply" } },
          { label: t.revert, icon: "refresh", style: "plain", action: { id: "revert" } },
          { label: t.refresh, icon: "refresh", style: "plain", action: { id: "refresh" } },
        ],
      },
      { type: "list", items: { $: "data.rows" } },
      { type: "text", text: { $: "data.more" }, tone: "muted" },
    ],
  };
}

/**
 * 快照 → 面板数据（语言无关的数字 + 该语言的文案）。
 * @param {object|null} snap  dshgo.js 里 buildSnapshot() 的产物
 * @param {string} [locale]
 */
export function panelDataFor(snap, locale) {
  const t = words(locale);
  if (!snap || snap.error) {
    return {
      applied: "0",
      pending: "0",
      stale: "0",
      env: "—",
      note: t.noteError,
      tone: "bad",
      rows: [],
      more: "",
    };
  }
  const tone = !snap.ok ? "bad" : snap.stale > 0 ? "warn" : snap.pending > 0 ? "info" : "good";
  const note = !snap.ok
    ? t.noteNoHost
    : snap.stale > 0
      ? t.noteStale(snap.stale)
      : snap.pending > 0
        ? t.notePending(snap.pending)
        : t.noteOk;

  const picked = pickRows(snap.rows);
  const hidden = Math.max(0, snap.applied - picked.filter((r) => r.status === "applied").length);
  return {
    applied: String(snap.applied),
    pending: String(snap.pending),
    stale: String(snap.stale),
    env: t.env(snap.env || "web"),
    note,
    tone,
    rows: picked.map((r) => ({
      title: `#${r.id} ${r.name}`,
      subtitle: locale && locale.toLowerCase().startsWith("en") ? LAYER_EN.get(r.layer) || r.layer : r.layer,
      trailing: statusText(r.status, t),
      tone: r.status === "applied" ? "good" : r.status === "pending" ? "warn" : "bad",
    })),
    more: hidden > 0 ? t.more(hidden) : "",
  };
}

function statusText(status, t) {
  if (status === "applied") return t.applied;
  if (status === "pending") return t.pending;
  return t.stale;
}

/** 状态条：24 字以内。 */
export function stripFor(snap, locale) {
  const t = words(locale);
  if (!snap || snap.error) return { text: t.noteError, icon: "wrench", tone: "bad" };
  if (!snap.ok) return { text: t.stripNoHost, icon: "wrench", tone: "warn" };
  const text = t.strip(snap.applied, snap.total);
  const tone = snap.stale > 0 ? "bad" : snap.pending > 0 ? "warn" : "good";
  return { text, icon: "wrench", tone };
}
