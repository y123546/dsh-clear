/**
 * dsh-Go 原生插槽的宿主半侧。
 *
 * 只做三件事：把当前状态压成一个快照、按语言推给面板/状态条、把按钮转成
 * **斜杠命令**（`purge apply` / `purge revert`）。
 *
 * 为什么按钮不直接调 apply：dsh-Go 给 handler 的时限是 3 秒，超时效果被丢弃；
 * 而真正应用补丁要读写几十个文件，肯定超。转成 command 效果由 App 在当前对话
 * 里执行，相当于用户自己敲了 `/purge apply`，结果也留在对话里可追溯。
 *
 * 没有桥接的主机（网页 / 桌面 / SSH）上 `ctx.inject(['dshGo'])` 的回调永不执行，
 * 这里的所有代码等于不存在 —— 网页版行为一点不变。
 */
import * as core from "./core.js";
import { panelDataFor, purgePanelView, stripFor } from "./dshgo-view.js";

const PANEL_ID = "purge";
const STRIP_ID = "status";

/** 把 gatherState 的结果压成语言无关的快照。 */
async function buildSnapshot(coreApi = core) {
  const state = await coreApi.gatherState();
  const status = state.patch_status || {};
  const rows = [];
  let applied = 0;
  let pending = 0;
  let stale = 0;
  let total = 0;
  for (const p of coreApi.ALL_PATCHES || []) {
    const s = status[p.id];
    if (!s || s === "na" || s === "off") continue;
    total += 1;
    if (s === "applied") applied += 1;
    else if (s === "pending") pending += 1;
    else if (s === "skipped" || s === "unmatched" || s === "pattern_not_found") stale += 1;
    rows.push({ id: p.id, name: p.name, layer: p.layer, status: s });
  }
  return {
    ok: Boolean(state.ai_base),
    env: state.host_env || state.surface || "web",
    total,
    applied,
    pending,
    stale,
    rows,
  };
}

/**
 * 注册面板、状态条与胶囊。
 * @param ctx cordis 上下文
 */
export function installDshGo(ctx, deps = {}) {
  const coreApi = deps.core || core;
  if (!ctx || typeof ctx.inject !== "function") return;
  ctx.inject(["dshGo"], (scoped) => {
    const api = scoped && scoped.dshGo;
    if (!api) return;

    const panelFeeds = new Set();
    const stripFeeds = new Set();
    let snapshot = null;
    let inflight = null;

    const publish = () => {
      for (const feed of panelFeeds) {
        try {
          feed.emit(panelDataFor(snapshot, feed.locale));
        } catch {
          /* 单条 feed 出错不连累其它 feed；连续违规由桥接自己降级 */
        }
      }
      for (const feed of stripFeeds) {
        try {
          feed.emit(stripFor(snapshot, feed.locale));
        } catch {
          /* 同上 */
        }
      }
    };

    const recompute = () => {
      if (inflight) return inflight;
      inflight = buildSnapshot(coreApi)
        .then((snap) => {
          snapshot = snap;
        })
        .catch((e) => {
          snapshot = { error: String(e && e.message ? e.message : e) };
        })
        .finally(() => {
          inflight = null;
          publish();
        });
      return inflight;
    };

    const commandEffect = (args) => ({ command: { name: "purge", args } });

    try {
      api.panel(PANEL_ID, {
        view: (scope, caps) => purgePanelView(scope, caps),
        data: (_scope, emit, caps) => {
          const feed = { emit, locale: caps && caps.locale };
          panelFeeds.add(feed);
          if (snapshot) feed.emit(panelDataFor(snapshot, feed.locale));
          else void recompute();
          return () => panelFeeds.delete(feed);
        },
        actions: {
          apply: () => commandEffect("apply"),
          revert: () => commandEffect("revert"),
          refresh: () => {
            void recompute();
            return { toast: "正在刷新 / refreshing" };
          },
        },
      });
    } catch {
      /* 老桥接没有 panel：其余插槽照常尝试 */
    }

    try {
      api.strip(STRIP_ID, (_scope, emit, caps) => {
        const feed = { emit, locale: caps && caps.locale };
        stripFeeds.add(feed);
        if (snapshot) feed.emit(stripFor(snapshot, feed.locale));
        else void recompute();
        return () => stripFeeds.delete(feed);
      });
    } catch {
      /* 没有 strip 的桥接 */
    }

    if (typeof api.on === "function") {
      try {
        api.on("apply", () => commandEffect("apply"));
        api.on("revert", () => commandEffect("revert"));
      } catch {
        /* 忽略：胶囊不可用不影响面板 */
      }
    }

    if (typeof scoped.effect === "function") {
      scoped.effect(() => () => {
        panelFeeds.clear();
        stripFeeds.clear();
      });
    }

    void recompute();
  });
}
