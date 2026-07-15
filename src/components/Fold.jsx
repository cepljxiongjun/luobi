import { useState } from "react";
import { sectionLabelCls } from "../ui";

// 可折叠的设置面板:收起时在标题旁显示当前状态摘要,减少左栏视觉负担
export default function Fold({ title, summary, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section>
      <button onClick={() => setOpen(o => !o)} aria-expanded={open}
        className={"group flex w-full cursor-pointer items-center gap-2 border-none bg-transparent p-0 text-left " +
          "focus-visible:outline-2 focus-visible:outline-indigo focus-visible:outline-offset-2 " +
          (open ? "mb-2.5" : "mb-0")}>
        <span className={sectionLabelCls + " font-sans group-hover:text-ink"}>{title}</span>
        {!open && summary && (
          <span className="ml-auto max-w-[170px] overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-indigo">{summary}</span>
        )}
        <span aria-hidden
          className={"text-[9px] text-ink-faint transition-transform " + (open ? "ml-auto rotate-90" : "ml-0")}>▶</span>
      </button>
      {open && children}
    </section>
  );
}
