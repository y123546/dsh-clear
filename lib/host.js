import { adapterFor, detectSurface, goHostInfo } from "./surface.js";
import * as desktop from "./desktop.js";
import * as web from "./web.js";

const ADAPTERS = {
  web,
  desktop,
};

export function currentSurface(input) {
  return detectSurface(input);
}

export function hostAdapter(kind = detectSurface()) {
  return ADAPTERS[adapterFor(kind)] || web;
}

export function scheduleRestart(request, ctx, options = {}) {
  /* dsh-Go 的本机引擎由 App 托管：从这里 spawn 重启会顶掉 App 手里的进程，
     重启后 App 连不上引擎，只能手动再点一次「启动」。所以只给提示，不动手。 */
  const go = goHostInfo();
  if (go.isGo) {
    return {
      restarting: false,
      clean: true,
      manual: true,
      error: "宿主是 dsh-Go 手机引擎，重启由 App 管理：请到 App 的「引擎」页重启，或重开 App 后生效 / restart the engine from the dsh-Go app",
    };
  }
  return hostAdapter().scheduleRestart(request, ctx, options);
}

export function scheduleCleanupRestart(opts) {
  return hostAdapter().scheduleCleanupRestart(opts);
}

export function restartNote() {
  return hostAdapter().restartNote();
}
