// 通用样式类名(Tailwind 组合),保持全站控件观感一致
export const chipCls = (active) =>
  "text-left rounded-md border transition-all cursor-pointer " +
  (active ? "bg-indigo-bg border-indigo" : "bg-white border-line hover:border-indigo");

export const btnCls =
  "bg-white border border-line text-ink-soft transition-all cursor-pointer " +
  "enabled:hover:bg-indigo-bg enabled:hover:border-indigo enabled:hover:text-indigo " +
  "disabled:opacity-45 disabled:cursor-default " +
  "focus-visible:outline-2 focus-visible:outline-indigo focus-visible:outline-offset-2";

export const inputCls =
  "w-full box-border px-3 py-[9px] rounded-md border border-line text-[13px] font-mono text-ink bg-white";

export const sectionLabelCls = "text-xs tracking-[2px] text-ink-faint";
