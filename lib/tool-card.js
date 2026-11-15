/**
 * 工具卡（dsh-Go 原生视图）的最小封装。
 *
 * 出处：dsh-Go 文档 docs/plugins/quickstart.md 的 12 行版本，MIT。
 * 它兜住三件会让**整次工具调用失败**的事，所以不要图省事直接 return 视图：
 *   · presentationMeta 抛错 → 工具调用失败
 *   · 返回值不是无损 JSON（含 undefined / NaN / Infinity / -0 / Date / Map）→ 工具调用失败
 *   · 视图超过 8 KiB → 整卡丢弃（工具卡要写进对话记录，必须小）
 *
 * 调用方只要保证 build 返回普通对象/数组即可。
 */
export function toolCard(build, maxBytes = 8 * 1024) {
  return (args, value) => {
    try {
      const text = JSON.stringify(build(args, value));
      if (text === undefined || Buffer.byteLength(text, "utf8") > maxBytes) return {};
      return { "dsh-go/view": JSON.parse(text) };
    } catch {
      return {};
    }
  };
}
