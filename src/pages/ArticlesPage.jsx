import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../store";
import { PLATFORMS, TONES } from "../lib/presets";
import { btnCls } from "../ui";

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

  const list = [...articles].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  return (
    <main className="mx-auto box-border w-full max-w-[960px] min-h-0 flex-1 overflow-y-auto px-7 pt-6 pb-10">
      <div className="mb-4 flex items-baseline gap-3">
        <h2 className="m-0 font-serif text-lg font-bold tracking-[2px]">文章库</h2>
        <span className="text-xs text-ink-faint">
          {list.length > 0 ? `${list.length} 篇` : ""}
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

      {list.length === 0 ? (
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
                    {a.title || "(未命名文章)"}
                  </button>
                  {editing && (
                    <span className="shrink-0 rounded-full bg-indigo-bg px-2 py-px text-[10px] text-indigo">编辑中</span>
                  )}
                  <span className="ml-auto shrink-0 text-[11px] text-ink-faint">{fmtTime(a.updatedAt)}</span>
                </div>

                {a.content && (
                  <div className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-ink-soft">{a.content}</div>
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
