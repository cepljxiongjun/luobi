import { useState } from "react";
import { useApp } from "../store";
import { openExternal } from "../lib/websearch";
import { btnCls } from "../ui";

// 联网资料面板(写作页左栏 Fold 内,320px 宽)。
//
// 存在的意义是**让"AI 查了什么"变成可见、可否决的**:模型带着检索结果写稿时,
// 用户唯一能判断稿子可不可信的方式,就是看见它到底读了哪几条、并且能划掉不靠谱的那条。
// 把这一层藏起来的联网功能,和让模型自由编造没有本质区别。
export default function RefsPanel() {
  const {
    topic, webReady, webEnabled, setWebEnabled,
    refs, refPlan, refsLoading, refsError, refsQuery, setRefsError,
    searchRefs, addRefByUrl, fetchRefText, toggleRef, removeRef, clearRefs, insertSources,
  } = useApp();
  const [q, setQ] = useState("");
  const [link, setLink] = useState("");
  const busy = !!refsLoading;

  const doSearch = () => searchRefs(q.trim() || topic.trim());
  const doAdd = async () => { if (await addRefByUrl(link)) setLink(""); };

  if (!webReady) {
    return (
      <div className="text-[11px] leading-relaxed text-ink-faint">
        还没有配置搜索源。到「设置 → 联网搜索」选一个搜索服务并填入 Key,
        之后落笔前会先联网查一遍资料,写出来的数字和时间就有出处了。
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div role="button" tabIndex={0}
        onClick={() => setWebEnabled(!webEnabled)}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setWebEnabled(!webEnabled); } }}
        className="flex cursor-pointer items-center gap-2">
        <span className={"flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] text-[10px] text-white " +
          (webEnabled ? "border-[1.5px] border-indigo bg-indigo" : "border-[1.5px] border-ink-faint bg-transparent")}>
          {webEnabled ? "✓" : ""}
        </span>
        <span className={"text-[13px] font-semibold " + (webEnabled ? "text-indigo" : "text-ink")}>联网写作</span>
        <span className="ml-auto text-[10px] text-ink-faint">{webEnabled ? "资料会注入提示词" : "已关闭,不注入"}</span>
      </div>

      <div className="flex gap-1.5">
        <input value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") doSearch(); }}
          placeholder={topic.trim() ? `留空即用主题:${topic.trim().slice(0, 12)}` : "要查什么?"}
          className="min-w-0 flex-1 rounded-md border border-line bg-white px-2.5 py-1.5 font-sans text-xs text-ink placeholder:text-ink-faint" />
        <button onClick={doSearch} disabled={busy || (!q.trim() && !topic.trim())}
          className={btnCls + " shrink-0 rounded-md px-2.5 text-xs"}>
          {refsLoading === "search" ? "检索中…" : "查资料"}
        </button>
      </div>

      <div className="flex gap-1.5">
        <input value={link} onChange={e => setLink(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") doAdd(); }}
          placeholder="或直接贴一个链接,抓正文" spellCheck={false}
          className="min-w-0 flex-1 rounded-md border border-dashed border-line bg-white px-2.5 py-1.5 font-sans text-xs text-ink placeholder:text-ink-faint" />
        <button onClick={doAdd} disabled={busy || !link.trim()}
          className={btnCls + " shrink-0 rounded-md px-2.5 text-xs"}>
          {refsLoading === "read" ? "抓取中…" : "抓取"}
        </button>
      </div>

      {refsError && (
        <div className="flex items-start gap-2 text-[11px] leading-relaxed text-seal">
          <span className="min-w-0 flex-1">{refsError}</span>
          <button onClick={() => setRefsError("")} aria-label="关闭提示"
            className="shrink-0 cursor-pointer border-none bg-transparent px-0.5 text-[13px] leading-none text-ink-faint">×</button>
        </div>
      )}

      {refs.length === 0 ? (
        <div className="text-[11px] leading-relaxed text-ink-faint">
          {webEnabled
            ? "还没有资料。点「落笔」会自动按主题查一次;也可以现在就手动查,挑完再动笔。"
            : "联网写作已关闭,查到的资料不会进入提示词。"}
        </div>
      ) : (
        <>
          {refsQuery && (
            <div className="text-[10px] text-ink-faint">最近检索:{refsQuery}</div>
          )}
          <div className="flex flex-col gap-1.5">
            {refs.map(r => {
              const dropped = refPlan.dropped.some(d => d.id === r.id);
              const on = r.picked !== false;
              return (
                <div key={r.id}
                  className={"rounded-md border px-2.5 py-2 transition-all " +
                    (on ? "border-line bg-white" : "border-line bg-paper-deep opacity-60")}>
                  <div className="flex items-start gap-1.5">
                    <button onClick={() => toggleRef(r.id)}
                      role="checkbox" aria-checked={on} aria-label={`${on ? "取消选用" : "选用"}:${r.title}`}
                      className={"mt-0.5 flex h-3.5 w-3.5 shrink-0 cursor-pointer items-center justify-center rounded-[3px] border-[1.5px] p-0 text-[10px] text-white " +
                        (on ? "border-indigo bg-indigo" : "border-ink-faint bg-transparent")}>
                      {on ? "✓" : ""}
                    </button>
                    <button onClick={() => openExternal(r.url)} title={r.url}
                      className="min-w-0 flex-1 cursor-pointer border-none bg-transparent p-0 text-left text-xs leading-snug font-semibold text-ink hover:text-indigo">
                      {r.title || r.url}
                    </button>
                    <button onClick={() => removeRef(r.id)} aria-label="移除这条资料"
                      className="shrink-0 cursor-pointer border-none bg-transparent px-0.5 text-[13px] leading-none text-ink-faint hover:text-seal">×</button>
                  </div>

                  <div className="mt-1 line-clamp-2 pl-5 text-[11px] leading-normal text-ink-faint">
                    {r.text ? r.text.slice(0, 160) : r.snippet}
                  </div>

                  <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-5">
                    {(r.site || r.date) && (
                      <span className="rounded-full bg-paper-deep px-1.5 py-px text-[10px] text-ink-faint">
                        {[r.site, r.date].filter(Boolean).join(" · ")}
                      </span>
                    )}
                    <span className="rounded-full bg-paper-deep px-1.5 py-px text-[10px] text-ink-faint">
                      {r.text ? "已抓正文" : "仅摘要"}
                    </span>
                    {dropped && on && (
                      <span className="rounded-full bg-paper-deep px-1.5 py-px text-[10px] text-ink-faint">超预算未注入</span>
                    )}
                    {!r.text && (
                      <button onClick={() => fetchRefText(r.id)} disabled={busy}
                        title="抓取这条链接的完整正文,引用具体数据时更可靠"
                        className={btnCls + " ml-auto rounded-full px-2 py-px text-[10px]"}>
                        {refsLoading === r.id ? "抓取中…" : "抓正文"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <span className="flex-1 text-[10px] text-ink-faint">
              {refPlan.used.length} 条生效 · 约 {Math.round(refPlan.chars / 100) / 10}k 字符
            </span>
            <button onClick={insertSources}
              title="把勾选的来源作为清单追加到正文末尾(知乎/公众号常用,小红书一般不需要)"
              className={btnCls + " shrink-0 rounded-full px-2.5 py-1 text-[11px]"}>
              插入参考来源
            </button>
            <button onClick={clearRefs} className={btnCls + " shrink-0 rounded-full px-2.5 py-1 text-[11px]"}>
              清空
            </button>
          </div>
        </>
      )}
    </div>
  );
}
