import { useLayoutEffect, useRef, useState } from "react";
import { clampX } from "../lib/textareaRect";

/**
 * 局部改写完成后的接受/放弃条,锚在改写结果的末尾。
 * 不设自动消失的超时——超时会让用户以为这次改动已经不可回退了。
 *
 * props: x/y 卡片相对坐标,boxWidth 卡片宽度,count 改写后的字数
 */
export default function AcceptBar({ x, y, boxWidth, count, onKeep, onUndo }) {
  const ref = useRef(null);
  const [left, setLeft] = useState(null);

  useLayoutEffect(() => {
    const w = ref.current?.offsetWidth || 0;
    setLeft(clampX(x, w, 8, boxWidth - 8));
  }, [x, boxWidth, count]);

  return (
    <div ref={ref}
      style={{ left: left ?? 0, top: y, visibility: left == null ? "hidden" : "visible" }}
      onMouseDown={e => e.preventDefault()}
      className="absolute z-20 flex items-center gap-2 rounded-lg border border-line bg-white py-1 pr-1 pl-3
                 shadow-[0_8px_24px_rgba(35,38,45,.12)]">
      <span className="text-[11px] text-ink-faint">已改写 {count} 字</span>
      <button onClick={onKeep}
        className="cursor-pointer rounded-md border-none bg-transparent px-2.5 py-1 text-[13px] text-indigo
                   transition-colors hover:bg-indigo-bg">
        保留
      </button>
      <button onClick={onUndo} title="回到改写前(Ctrl/Cmd+Z)"
        className="cursor-pointer rounded-md border-none bg-transparent px-2.5 py-1 text-[13px] text-ink-soft
                   transition-colors hover:bg-indigo-bg hover:text-indigo">
        撤销
      </button>
    </div>
  );
}
