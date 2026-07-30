import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../store";
import { PLATFORMS, TONES } from "../lib/presets";
import { btnCls, inputCls } from "../ui";

const fmtTime = (ts) => {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// 文章库:管理已保存的文章(继续编辑 / 导出 .md / 删除)
export default function ArticlesPage() {
  const nav = useNavigate();
  const {
    articles, currentArticleId, openArticle, deleteArticle, exportMd,
    articlesDir, storageError, storageBusy, rescanArticles,
  } = useApp();
  const [confirmId, setConfirmId] = useState(null); // 两步删除:先点删除,再点确认
  const [q, setQ] = useState("");

  // 搜索走内存过滤而不是数据库索引:文章本来就全量在内存里(readAll 启动时读了
  // 每个文件),所以这里零 I/O。实测 800 篇 / 1MB 中文语料下 SQLite 的 FTS5
  // trigram 索引也只是 1-2ms,并不比全扫快,而内存过滤连 IPC 都省了,
  // 且浏览器端同样生效 —— SQLite 只在桌面端有。
  const kw = q.trim().toLowerCase();
  const list = useMemo(() => {
    const sorted = [...articles].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (!kw) return sorted;
    return sorted.filter(a =>
      (a.title || "").toLowerCase().includes(kw) ||
      (a.content || "").toLowerCase().includes(kw) ||
      (a.topic || "").toLowerCase().includes(kw));
  }, [articles, kw]);

  // 命中处前后各留一点上下文当预览,让用户一眼看到为什么这篇被搜出来
  const preview = (a) => {
    if (!kw) return a.content;
    const i = (a.content || "").toLowerCase().indexOf(kw);
    if (i < 0) return a.content;
    const from = Math.max(0, i - 30);
    return (from > 0 ? "…" : "") + a.content.slice(from, i + kw.length + 90);
  };

  // 把命中的片段标出来。用 <mark> 而不是自绘 span:语义正确,也能被读屏器识别
  const highlight = (text) => {
    if (!kw) return text;
    const parts = [];
    const low = text.toLowerCase();
    let at = 0;
    for (let i = low.indexOf(kw); i >= 0 && parts.length < 40; i = low.indexOf(kw, at)) {
      if (i > at) parts.push(text.slice(at, i));
      parts.push(<mark key={i} className="bg-indigo-bg text-indigo">{text.slice(i, i + kw.length)}</mark>);
      at = i + kw.length;
    }
    parts.push(text.slice(at));
    return parts;
  };

  return (
    <main className="mx-auto box-border w-full max-w-[960px] min-h-0 flex-1 overflow-y-auto px-7 pt-6 pb-10">
      <div className="mb-4 flex items-baseline gap-3">
        <h2 className="m-0 font-serif text-lg font-bold tracking-[2px]">文章库</h2>
        <span className="text-xs text-ink-faint">
          {articles.length > 0 ? `${articles.length} 篇` : ""}
        </span>
        {/* 存在自选文件夹时给个手动出口:用户可能刚在 Obsidian 里改过文件 */}
        {articlesDir && (
          <button onClick={rescanArticles} disabled={storageBusy}
            title="重新读取存储文件夹,拾取在外部编辑器里做的改动"
            className={btnCls + " ml-auto rounded-full px-3.5 py-[6px] text-[13px]"}>
            {storageBusy ? "扫描中…" : "⟳ 重新扫描"}
          </button>
        )}
        <button onClick={() => nav("/write")}
          className={btnCls + (articlesDir ? " " : " ml-auto ") + "rounded-full px-3.5 py-[6px] text-[13px]"}>
          ✎ 去写作
        </button>
      </div>

      {articles.length > 0 && (
        <div className="mb-4 flex items-center gap-2.5">
          <input value={q} onChange={e => setQ(e.target.value)}
            placeholder="搜索标题、正文、主题…"
            className={inputCls + " flex-1 font-sans text-[13px]"} />
          {kw && (
            <span className="shrink-0 text-[11px] text-ink-faint">
              {list.length > 0 ? `命中 ${list.length} 篇` : "没有匹配的文章"}
            </span>
          )}
          {q && (
            <button onClick={() => setQ("")} className={btnCls + " shrink-0 rounded-full px-3 py-1 text-xs"}>
              清空
            </button>
          )}
        </div>
      )}

      {/* 降级横幅:存储位置出问题时必须显眼,但文章一篇都没丢,只是暂时存回了内部存储 */}
      {storageError && (
        <div className="mb-3 flex items-center gap-3 rounded-[10px] border border-line bg-white px-4 py-3">
          <div className="flex-1 text-[13px] leading-relaxed text-seal">{storageError}</div>
          {articlesDir && (
            <button onClick={rescanArticles} disabled={storageBusy}
              className={btnCls + " shrink-0 rounded-full px-3 py-1 text-xs"}>
              重试
            </button>
          )}
        </div>
      )}

      {list.length === 0 && kw ? (
        <div className="rounded-[10px] border border-line bg-white px-10 py-16 text-center text-[13px] text-ink-faint">
          没有包含「{q.trim()}」的文章
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[10px] border border-line bg-white px-10 py-20 text-center">
          <div className="font-serif text-[22px] tracking-[3px] text-ink-faint">文库空空,还没有保存的文章</div>
          <div className="text-[13px] leading-loose text-ink-faint">
            在写作页完成创作后,点「保存」即可存入文库<br />
            保存的文章会留在本机,刷新或重启都不会丢
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {list.map(a => {
            const platform = PLATFORMS.find(p => p.id === a.platformId);
            const tone = TONES.find(t => t.id === a.toneId);
            const words = (a.content || "").replace(/\s/g, "").length;
            const editing = a.id === currentArticleId;
            return (
              <div key={a.id} className="rounded-[10px] border border-line bg-white p-4 transition-all hover:border-indigo">
                <div className="flex items-baseline gap-2.5">
                  <button onClick={() => { openArticle(a.id); nav("/write"); }}
                    className="cursor-pointer border-none bg-transparent p-0 text-left font-serif text-base font-bold text-ink transition-colors hover:text-indigo">
                    {a.title ? highlight(a.title) : "(未命名文章)"}
                  </button>
                  {editing && (
                    <span className="shrink-0 rounded-full bg-indigo-bg px-2 py-px text-[10px] text-indigo">编辑中</span>
                  )}
                  <span className="ml-auto shrink-0 text-[11px] text-ink-faint">{fmtTime(a.updatedAt)}</span>
                </div>

                {a.content && (
                  <div className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-ink-soft">
                    {highlight(preview(a))}
                  </div>
                )}

                <div className="mt-2.5 flex items-center gap-2">
                  <span className="text-[11px] text-ink-faint">
                    {[platform?.name, tone?.name, `${words} 字`].filter(Boolean).join(" · ")}
                  </span>
                  <button onClick={() => { openArticle(a.id); nav("/write"); }}
                    className={btnCls + " ml-auto rounded-full px-3 py-1 text-xs"}>
                    继续编辑
                  </button>
                  <button onClick={() => exportMd(a)}
                    className={btnCls + " rounded-full px-3 py-1 text-xs"}>
                    导出 .md
                  </button>
                  {confirmId === a.id ? (
                    <button onClick={() => { deleteArticle(a.id); setConfirmId(null); }}
                      onBlur={() => setConfirmId(null)}
                      className="cursor-pointer rounded-full border border-ink bg-ink px-3 py-1 text-xs text-white transition-opacity hover:opacity-80">
                      确认删除?
                    </button>
                  ) : (
                    <button onClick={() => setConfirmId(a.id)}
                      className={btnCls + " rounded-full px-3 py-1 text-xs"}>
                      删除
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
