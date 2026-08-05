import { useEffect, useState } from "react";
import { useApp } from "../store";
import { openExternal } from "../lib/websearch";
import { btnCls } from "../ui";

// 全网热榜面板(选题灵感 Fold 内)。挂载即拉取(Fold 展开才渲染 children,
// 所以"展开即刷新",10 分钟内有缓存不重复请求)。免 Key,不依赖搜索源配置。
//
// 点条目 = 把热点填进主题框;「⌕ 角度」= 按这个热点跑一遍选题灵感
// (检索它的讨论并提炼切入角度,需要配好搜索源)。
export default function HotBoard() {
  const { hotBoards, hotLoading, hotError, fetchHot, topic, setTopic, webReady, genTopicIdeas, inspoLoading } = useApp();
  const [boardId, setBoardId] = useState("");
  useEffect(() => { fetchHot(); }, []);

  const board = hotBoards.find(b => b.id === boardId) || hotBoards[0];

  if (hotLoading && hotBoards.length === 0) {
    return <div className="text-[11px] text-ink-faint">正在拉取全网热榜…</div>;
  }
  if (hotError && hotBoards.length === 0) {
    return (
      <div className="flex items-start gap-2 text-[11px] leading-relaxed text-ink-faint">
        <span className="min-w-0 flex-1">{hotError}</span>
        <button onClick={() => fetchHot(true)} className={btnCls + " shrink-0 rounded-full px-2.5 py-1 text-[11px]"}>
          重试
        </button>
      </div>
    );
  }
  if (!board) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1">
        {hotBoards.map(b => (
          <button key={b.id} onClick={() => setBoardId(b.id)}
            className={"cursor-pointer rounded-full border px-2 py-px text-[10px] transition-all " +
              (board.id === b.id ? "border-indigo bg-indigo-bg font-semibold text-indigo"
                : "border-line bg-white text-ink-soft hover:border-indigo hover:text-indigo")}>
            {b.name}
          </button>
        ))}
        <button onClick={() => fetchHot(true)} disabled={hotLoading} title="重新拉取热榜"
          className={btnCls + " ml-auto shrink-0 rounded-full px-2 py-px text-[10px]"}>
          {hotLoading ? "…" : "⟳"}
        </button>
      </div>

      <div className="flex flex-col gap-0.5">
        {board.items.slice(0, 10).map((it, i) => {
          const picked = topic === it.title;
          return (
            <div key={i} className="group flex items-center gap-1.5">
              <span className={"w-4 shrink-0 text-center font-serif text-[11px] " +
                (i < 3 ? "font-bold text-seal" : "text-ink-faint")}>{i + 1}</span>
              <button onClick={() => setTopic(it.title)}
                title={it.url ? "点击填进主题框;右侧 ↗ 看原文" : "点击填进主题框"}
                className={"min-w-0 flex-1 cursor-pointer overflow-hidden border-none bg-transparent p-0 text-left text-[12px] leading-[1.9] text-ellipsis whitespace-nowrap transition-colors " +
                  (picked ? "font-semibold text-indigo" : "text-ink hover:text-indigo")}>
                {picked && "✓ "}{it.title}
              </button>
              {webReady && (
                <button onClick={() => genTopicIdeas(it.title)} disabled={inspoLoading}
                  title="检索这个热点的讨论,提炼出选题角度"
                  className="hidden shrink-0 cursor-pointer rounded-full border border-line bg-white px-1.5 py-px text-[10px] text-ink-soft group-hover:inline-block hover:border-indigo hover:text-indigo">
                  ⌕ 角度
                </button>
              )}
              {it.url && (
                <button onClick={() => openExternal(it.url)} aria-label="打开原文"
                  className="hidden shrink-0 cursor-pointer border-none bg-transparent p-0 text-[10px] text-ink-faint group-hover:inline-block hover:text-indigo">
                  ↗
                </button>
              )}
              {it.heat && (
                <span className="shrink-0 text-[10px] text-ink-faint group-hover:hidden">{it.heat}</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="text-[10px] text-ink-faint">点条目填进主题框;悬停可看角度与原文</div>
    </div>
  );
}
