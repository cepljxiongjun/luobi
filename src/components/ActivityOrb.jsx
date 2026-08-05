import { useEffect, useState } from "react";
import { useApp } from "../store";
import { openExternal } from "../lib/websearch";
import { btnCls } from "../ui";

// 悬浮的过程指示器:AI 在忙时显示「思考中 / 联网中 / 抓取中」,点开能看到每一步
// 到底做了什么——包括发出去的提示词全文。
//
// 为什么值得做:模型给的是结果,过程全在暗处。用户想知道"这段数字哪来的""为什么
// 这次写得不像我要的",唯一的答案在提示词里。把它摆出来,比在设置页写十条说明有用。
// 与「联网资料可见可否决」是同一个立场的两半。
//
// 挂在 Layout 里而不是写作页:写作页、图文页都会产生活动,切页面时球不该消失。
//
// 设置页的两个「测试连接」**故意不留痕**:这里记的是"为了写这篇稿子做了什么",
// 不是网络活动日志;而且它们的结果就显示在按钮旁边,再记一条只会稀释真正的过程。

const KIND = {
  model: { icon: "✎", busy: "思考中", name: "模型" },
  web: { icon: "⌕", busy: "联网中", name: "联网检索" },
  read: { icon: "↓", busy: "抓取中", name: "网页抓取" },
};

const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);
const fmtAt = (t) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
};

// 提示词可能几千字,面板里默认只给前一段,展开才给全文
const preCls = "max-h-[200px] overflow-auto rounded-md bg-paper-deep px-2.5 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-ink-soft";

function Detail({ step }) {
  const d = step.detail || {};
  if (step.kind === "web") {
    const list = d.results || [];
    return (
      <div className="flex flex-col gap-2">
        <div className="text-[11px] text-ink-faint">
          搜索源 {d.provider || "—"} · 取 {d.count} 条 · 时间范围 {d.freshness === "noLimit" ? "不限" : d.freshness}
        </div>
        <div className={preCls}>{d.query}</div>
        {list.length > 0 && (
          <div className="flex flex-col gap-1">
            {list.map((r, i) => (
              <button key={i} onClick={() => openExternal(r.url)} title={r.url}
                className="cursor-pointer rounded-md border border-line bg-white px-2.5 py-1.5 text-left transition-colors hover:border-indigo">
                <div className="text-[12px] leading-snug font-semibold text-ink">{i + 1}. {r.title}</div>
                <div className="mt-0.5 text-[10px] text-ink-faint">{[r.site, r.date].filter(Boolean).join(" · ")}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (step.kind === "read") {
    return (
      <div className="flex flex-col gap-2">
        <button onClick={() => openExternal(d.url)}
          className="cursor-pointer border-none bg-transparent p-0 text-left font-mono text-[11px] break-all text-indigo hover:underline">
          {d.url}
        </button>
        {d.chars != null && (
          <div className="text-[11px] text-ink-faint">抓到正文 {d.chars} 字{d.title ? ` · ${d.title}` : ""}</div>
        )}
        {d.text && <div className={preCls}>{d.text.slice(0, 1500)}{d.text.length > 1500 ? "\n…" : ""}</div>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-paper-deep px-2 py-px text-[10px] text-ink-faint">模型 {d.model || "—"}</span>
        <span className="rounded-full bg-paper-deep px-2 py-px text-[10px] text-ink-faint">
          技能 {d.skills?.length ? d.skills.join("、") : "无"}
        </span>
        <span className="rounded-full bg-paper-deep px-2 py-px text-[10px] text-ink-faint">
          资料 {d.refs?.length ? `${d.refs.length} 条` : "无"}
        </span>
      </div>
      <div>
        <div className="mb-1 text-[10px] tracking-[1px] text-ink-faint">系统提示词(角色 + 平台语气 + 技能 + 联网资料)</div>
        <div className={preCls}>{d.system}</div>
      </div>
      <div>
        <div className="mb-1 text-[10px] tracking-[1px] text-ink-faint">这次发过去的指令</div>
        <div className={preCls}>{d.user}</div>
      </div>
      {d.result && (
        <div>
          <div className="mb-1 text-[10px] tracking-[1px] text-ink-faint">模型返回</div>
          <div className={preCls}>{d.result.slice(0, 2000)}{d.result.length > 2000 ? "\n…" : ""}</div>
        </div>
      )}
    </div>
  );
}

export default function ActivityOrb() {
  const { trace, activity, clearTrace } = useApp();
  const [open, setOpen] = useState(false);
  const [openStep, setOpenStep] = useState(null);

  // Esc 关面板。与写作页那套"逐层关闭"不冲突:这里只在自己开着时吃掉这一下
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [open]);

  if (trace.length === 0 && !activity) return null; // 什么都没发生过时不占地方

  const k = activity ? (KIND[activity.kind] || KIND.model) : null;
  const failed = trace.filter(s => s.status === "failed").length;

  return (
    <>
      {open && (
        <>
          {/* 点空白关闭。z 比面板低一层,比页面里所有弹层高 */}
          <div onClick={() => setOpen(false)} className="fixed inset-0 z-50" />
          <div role="dialog" aria-label="AI 过程"
            className="fixed right-4 bottom-[68px] z-51 flex max-h-[min(560px,70vh)] w-[440px] max-w-[calc(100vw-2rem)] flex-col rounded-xl border border-line bg-white shadow-[0_12px_40px_rgba(35,38,45,.16)]">
            <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
              <span className="font-serif text-[15px] font-bold tracking-[1px]">AI 过程</span>
              <span className="text-[11px] text-ink-faint">最近 {trace.length} 步{failed ? ` · ${failed} 步失败` : ""}</span>
              <button onClick={clearTrace} className={btnCls + " ml-auto rounded-full px-2.5 py-1 text-[11px]"}>清空</button>
              <button onClick={() => setOpen(false)} aria-label="关闭"
                className="cursor-pointer border-none bg-transparent px-1 text-base leading-none text-ink-faint hover:text-ink">×</button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
              <div className="flex flex-col gap-1.5">
                {[...trace].reverse().map(s => {
                  const kd = KIND[s.kind] || KIND.model;
                  const expanded = openStep === s.id;
                  return (
                    <div key={s.id} className="rounded-lg border border-line bg-white">
                      <button onClick={() => setOpenStep(expanded ? null : s.id)} aria-expanded={expanded}
                        className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3 py-2.5 text-left">
                        <span aria-hidden className={"shrink-0 text-[13px] " +
                          (s.status === "failed" ? "text-seal" : s.status === "running" ? "text-indigo" : "text-ink-faint")}>
                          {kd.icon}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold text-ink">{s.label}</span>
                          <span className="mt-0.5 block text-[10px] text-ink-faint">
                            {fmtAt(s.at)} · {kd.name}
                            {s.status === "running" ? " · 进行中" : ` · ${fmtMs(s.ms)}`}
                          </span>
                        </span>
                        {s.status === "failed" && (
                          <span className="shrink-0 rounded-full bg-paper-deep px-2 py-px text-[10px] text-seal">失败</span>
                        )}
                        {s.status === "running" && (
                          <span className="shrink-0 animate-pulse rounded-full bg-indigo-bg px-2 py-px text-[10px] text-indigo">进行中</span>
                        )}
                        {/* 展开态用旋转而不是换成 ▴:同一个字形一定渲染得出来,换一个就未必 */}
                        <span aria-hidden className={"shrink-0 text-[9px] text-ink-faint transition-transform " +
                          (expanded ? "rotate-180" : "")}>▾</span>
                      </button>
                      {expanded && (
                        <div className="border-t border-line px-3 py-2.5">
                          {s.error && <div className="mb-2 text-[12px] leading-relaxed text-seal">{s.error}</div>}
                          <Detail step={s} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="shrink-0 border-t border-line px-4 py-2 text-[10px] leading-relaxed text-ink-faint">
              这里是原样的请求内容,不含任何 Key。只留最近 30 步,刷新即清空。
            </div>
          </div>
        </>
      )}

      <button onClick={() => setOpen(o => !o)} aria-expanded={open}
        aria-label={activity ? `${k.busy}:${activity.label},点击查看过程` : "查看 AI 过程"}
        title={activity ? activity.label : "查看 AI 过程"}
        className={"fixed right-4 bottom-4 z-52 flex cursor-pointer items-center gap-2 rounded-full border py-2 pr-3.5 pl-3 text-xs shadow-[0_6px_20px_rgba(35,38,45,.14)] transition-all " +
          (activity ? "border-indigo bg-indigo-bg text-indigo" : "border-line bg-white text-ink-soft hover:border-indigo hover:text-indigo")}>
        <span className="relative flex h-2 w-2 shrink-0">
          {activity && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo opacity-60" />}
          <span className={"relative inline-flex h-2 w-2 rounded-full " + (activity ? "bg-indigo" : "bg-ink-faint")} />
        </span>
        <span className="font-semibold">{activity ? k.busy : "过程"}</span>
        {activity
          ? <span className="max-w-[140px] truncate text-[11px] opacity-80">{activity.label}</span>
          : <span className="text-[11px] text-ink-faint">{trace.length}</span>}
      </button>
    </>
  );
}
