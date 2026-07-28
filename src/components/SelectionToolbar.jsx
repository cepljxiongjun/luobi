import { useLayoutEffect, useRef, useState } from "react";
import { clampX } from "../lib/textareaRect";

/**
 * 选区浮条:选中正文后浮在选区上方,把 AI 改写搬到手边(对标 Notion AI / 秘塔)
 * 坐标是"正文卡片相对",卡片本身是 relative,所以滚动时天然跟随。
 *
 * props:
 *   x        选区首行中心的横坐标(卡片相对),浮条会以它居中并夹回卡片内
 *   y        浮条应占的 top(卡片相对),调用方已按可视区收敛过
 *   boxWidth 卡片宽度,横向夹取用
 *   actions  [{id, name}]
 *   busy     AI 忙时禁用
 */
export default function SelectionToolbar({ x, y, boxWidth, actions, onAction, onMore, busy }) {
  const ref = useRef(null);
  const [left, setLeft] = useState(null);

  // 先量自身宽度再定位:useLayoutEffect 在 paint 前跑完,用户看不到"先偏后正"的跳动
  useLayoutEffect(() => {
    const w = ref.current?.offsetWidth || 0;
    setLeft(clampX(x - w / 2, w, 8, boxWidth - 8));
  }, [x, boxWidth, actions.length]);

  return (
    <div ref={ref}
      style={{ left: left ?? 0, top: y, visibility: left == null ? "hidden" : "visible" }}
      // 不抢 textarea 焦点,原生选区高亮才不会消失,选区偏移也不会被 blur 打断
      onMouseDown={e => e.preventDefault()}
      className="absolute z-20 flex items-center gap-0.5 rounded-lg border border-line bg-white p-1
                 shadow-[0_8px_24px_rgba(35,38,45,.12)]">
      {actions.map(a => (
        <button key={a.id} disabled={busy} onClick={() => onAction(a)}
          className="cursor-pointer rounded-md border-none bg-transparent px-2.5 py-1.5 text-[13px] text-ink-soft
                     transition-colors enabled:hover:bg-indigo-bg enabled:hover:text-indigo disabled:opacity-45">
          {a.name}
        </button>
      ))}
      <div className="mx-0.5 h-4 w-px bg-line" />
      <button disabled={busy} onClick={onMore} title="更多操作(等同右键)"
        className="cursor-pointer rounded-md border-none bg-transparent px-2 py-1.5 text-[13px] text-ink-faint
                   transition-colors enabled:hover:bg-indigo-bg enabled:hover:text-indigo disabled:opacity-45">
        ⋯
      </button>
    </div>
  );
}
