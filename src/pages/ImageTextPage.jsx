import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../store";
import { IT_THEMES, IT_RATIOS, IT_FONT_SIZES } from "../lib/cards";
import { chipCls, btnCls, sectionLabelCls } from "../ui";

// 单张卡片预览:主题色是运行时数据,保留内联样式
function CardPreview({ kind, data, index }) {
  const { itTheme, itRatioId, itScale, itSignature, itCards, itExportOne } = useApp();
  const pw = 236, ph = itRatioId === "3:4" ? Math.round(pw * 4 / 3) : pw;
  const sig = itSignature.trim() || "落笔图文";
  const frame = {
    width: pw, height: ph,
    background: `linear-gradient(${itTheme.bg}, ${itTheme.bg2})`,
    border: `1px solid ${itTheme.line}`,
  };

  return (
    <div style={{ width: pw }}>
      {kind === "cover" ? (
        <div className="relative box-border flex flex-col overflow-hidden rounded-lg p-[18px]" style={frame}>
          <div className="font-sans" style={{ fontSize: 9 * itScale + 1, color: itTheme.sub }}>{sig}</div>
          <div className="my-auto">
            <span className="mb-2.5 inline-block px-2 py-[3px] font-semibold"
              style={{ background: itTheme.accent, color: itTheme.chipFg, fontSize: 9 * itScale + 1 }}>{data.cover.tag}</span>
            <div className="font-serif font-bold" style={{ color: itTheme.fg, fontSize: 19 * itScale, lineHeight: 1.5 }}>{data.cover.title}</div>
          </div>
          <div>
            <div className="mb-2 h-0.5 w-[26px]" style={{ background: itTheme.accent }} />
            <div style={{ fontSize: 8 * itScale + 1, color: itTheme.sub }}>左滑查看全文 →</div>
          </div>
        </div>
      ) : (
        <div className="relative box-border flex flex-col overflow-hidden rounded-lg p-[18px]" style={frame}>
          <div className="absolute top-1.5 right-3.5 font-serif text-[34px] font-bold" style={{ color: itTheme.line }}>
            {String(index + 1).padStart(2, "0")}
          </div>
          <div className="mb-3 flex items-center gap-[7px]">
            <span className="h-3.5 w-[3px] shrink-0" style={{ background: itTheme.accent }} />
            <span className="font-serif font-bold" style={{ color: itTheme.fg, fontSize: 13 * itScale + 1 }}>{data.heading}</span>
          </div>
          <div className="flex flex-1 flex-col gap-2 overflow-hidden">
            {data.points.map((pt, j) => (
              <div key={j} className="flex gap-1.5" style={{ fontSize: 9 * itScale + 1, lineHeight: 1.7, color: itTheme.fg }}>
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ background: itTheme.accent }} />
                <span>{pt}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-between pt-1.5 text-[8px]"
            style={{ borderTop: `1px solid ${itTheme.line}`, color: itTheme.sub }}>
            <span>{sig}</span><span>{index + 1} / {itCards.pages.length}</span>
          </div>
        </div>
      )}
      <button onClick={() => itExportOne(kind, index)}
        className={btnCls + " mt-1.5 w-full rounded-md py-[5px] text-[11px]"}>
        {kind === "cover" ? "下载封面" : "下载本页"}
      </button>
    </div>
  );
}

export default function ImageTextPage() {
  const {
    content, docTitle,
    itSource, setItSource, itSignature, setItSignature,
    itThemeId, setItThemeId, itRatioId, setItRatioId, itFontId, setItFontId,
    itRatio, itCards, itLoading, itError, itNote, itCopied,
    itImportDraft, itSplit, itExportAll, itCopyText,
    itMode, setItMode, itTopic, setItTopic, itRefNote, setItRefNote, itGenerate,
    itRefLoading, itFetchRefNote,
    itTitles, itTitlesLoading, itGenTitles, itPickTitle,
    itCaption, itCaptionLoading, itCaptionCopied, itGenCaption, itCopyCaption,
    webOn, webReady, refPlan, refsLoading,
  } = useApp();
  const nav = useNavigate();
  const [refLink, setRefLink] = useState(""); // 参考爆款笔记的链接(抓正文填进下面的输入框)

  return (
    <main className="mx-auto box-border grid w-full max-w-[1440px] min-h-0 flex-1 grid-cols-[320px_1fr] gap-8 px-7 pt-6 pb-7">

      {/* 左栏:图文设置 */}
      <aside className="flex min-h-0 flex-col gap-5 overflow-y-auto pr-1">
        <section>
          <div className={sectionLabelCls + " mb-2.5"}>内容来源</div>
          {/* 两种生成方式:已有文章拆卡 / 主题直出(调研:ai-xiaohs 灵感创作 + 爆款仿写) */}
          <div className="mb-2.5 grid grid-cols-2 gap-2">
            {[{ id: "article", name: "已有文章", desc: "粘贴或带入草稿拆卡" },
              { id: "topic", name: "主题直出", desc: "输入主题一键生成" }].map(m => (
              <button key={m.id} onClick={() => setItMode(m.id)}
                className={chipCls(itMode === m.id) + " px-3 py-[9px]"}>
                <div className={"text-[13px] font-semibold " + (itMode === m.id ? "text-indigo" : "text-ink")}>{m.name}</div>
                <div className="mt-0.5 text-[10px] text-ink-faint">{m.desc}</div>
              </button>
            ))}
          </div>

          {itMode === "article" ? (
            <>
              <textarea value={itSource} onChange={e => setItSource(e.target.value)}
                placeholder="粘贴要做成图文的文章,或点下方按钮从写作模块带入……" rows={7}
                className="box-border w-full resize-y rounded-md border border-line bg-white px-3 py-2.5 font-sans text-[13px] leading-[1.8] text-ink" />
              <div className="mt-2 flex gap-2">
                <button onClick={itImportDraft} disabled={!content.trim() && !docTitle.trim()}
                  className={btnCls + " rounded-full px-3 py-[5px] text-xs"}>
                  ← 带入写作草稿
                </button>
                <span className="self-center text-[11px] text-ink-faint">
                  {itSource.trim() ? `${itSource.replace(/\s/g, "").length} 字` : ""}
                </span>
              </div>
            </>
          ) : (
            <>
              <textarea value={itTopic} onChange={e => setItTopic(e.target.value)}
                placeholder={"想做什么主题的图文?比如:\n「租房避坑的8条经验」「新手健身一周计划」"} rows={3}
                className="box-border w-full resize-y rounded-md border border-line bg-white px-3 py-2.5 font-sans text-[13px] leading-[1.8] text-ink" />
              {/* 参考笔记通常就是浏览器里开着的那一篇,给个链接比"全选复制再粘回来"顺手 */}
              <div className="mt-2 flex gap-1.5">
                <input value={refLink} onChange={e => setRefLink(e.target.value)}
                  onKeyDown={async e => { if (e.key === "Enter" && await itFetchRefNote(refLink)) setRefLink(""); }}
                  placeholder="参考笔记的链接(可选,抓正文填到下面)" spellCheck={false}
                  className="min-w-0 flex-1 rounded-md border border-dashed border-line bg-white px-2.5 py-1.5 font-sans text-xs text-ink placeholder:text-ink-faint" />
                <button onClick={async () => { if (await itFetchRefNote(refLink)) setRefLink(""); }}
                  disabled={itRefLoading || !refLink.trim()}
                  className={btnCls + " shrink-0 rounded-md px-2.5 text-xs"}>
                  {itRefLoading ? "抓取中…" : "抓取"}
                </button>
              </div>
              <textarea value={itRefNote} onChange={e => setItRefNote(e.target.value)}
                placeholder="(可选)粘贴一篇参考爆款笔记,AI 只仿它的结构和写法,不抄内容" rows={4}
                className="mt-1.5 box-border w-full resize-y rounded-md border border-dashed border-line bg-white px-3 py-2.5 font-sans text-xs leading-[1.8] text-ink placeholder:text-ink-faint" />

              {/* 联网状态:主题直出是最需要真实素材的场景,得让用户知道这次带没带资料 */}
              <div className="mt-2 text-[11px] leading-relaxed text-ink-faint">
                {webOn
                  ? (refPlan.used.length > 0
                    ? `联网写作已开启 · ${refPlan.used.length} 条资料会作为事实依据带上`
                    : "联网写作已开启 · 生成前会先按主题查一次资料")
                  : (
                    <>
                      联网写作未开启,内容全凭模型自身知识。
                      <button onClick={() => nav("/settings")}
                        className="ml-1 cursor-pointer border-none bg-transparent p-0 text-[11px] text-indigo underline">
                        {webReady ? "去开启" : "去配置"}
                      </button>
                    </>
                  )}
              </div>
            </>
          )}
        </section>

        <section>
          <div className={sectionLabelCls + " mb-2.5"}>模板主题</div>
          <div className="grid grid-cols-2 gap-2">
            {IT_THEMES.map(t => (
              <button key={t.id} onClick={() => setItThemeId(t.id)}
                className={chipCls(itThemeId === t.id) + " px-3 py-[9px]"}>
                <div className="flex items-center gap-[7px]">
                  <span className="h-4 w-4 shrink-0 rounded"
                    style={{ background: t.bg, border: `1px solid ${t.line}`, boxShadow: `inset -4px -4px 0 ${t.accent}` }} />
                  <span className={"text-[13px] font-semibold " + (itThemeId === t.id ? "text-indigo" : "text-ink")}>{t.name}</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className={sectionLabelCls + " mb-2.5"}>画幅与字号</div>
          <div className="grid grid-cols-2 gap-2">
            {IT_RATIOS.map(r => (
              <button key={r.id} onClick={() => setItRatioId(r.id)}
                className={chipCls(itRatioId === r.id) + " px-3 py-[9px]"}>
                <div className={"text-[13px] font-semibold " + (itRatioId === r.id ? "text-indigo" : "text-ink")}>{r.name}</div>
                <div className="mt-0.5 text-[10px] text-ink-faint">{r.desc}</div>
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            {IT_FONT_SIZES.map(f => (
              <button key={f.id} onClick={() => setItFontId(f.id)}
                className={"flex-1 cursor-pointer rounded-md border py-1.5 text-center text-xs transition-all " +
                  (itFontId === f.id ? "border-indigo bg-indigo-bg font-semibold text-indigo" : "border-line bg-white text-ink-soft hover:border-indigo")}>
                {f.name}
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className={sectionLabelCls + " mb-2.5"}>卡片署名</div>
          <input value={itSignature} onChange={e => setItSignature(e.target.value)}
            placeholder="如:@你的账号名(留空显示「落笔图文」)" spellCheck={false}
            className="box-border w-full rounded-md border border-line bg-white px-3 py-[9px] font-sans text-[13px] text-ink" />
        </section>

        <section className="flex flex-col gap-2">
          {itMode === "article" ? (
            <>
              <button onClick={() => itSplit(true)} disabled={itLoading || !itSource.trim()}
                className="cursor-pointer rounded-lg border-none bg-indigo py-[11px] text-sm font-semibold tracking-[2px] text-white
                  disabled:cursor-default disabled:opacity-50
                  focus-visible:outline-2 focus-visible:outline-indigo focus-visible:outline-offset-2">
                {itLoading ? "拆分中…" : "AI 拆分成卡片"}
              </button>
              <button onClick={() => itSplit(false)} disabled={itLoading || !itSource.trim()}
                className={btnCls + " rounded-lg py-2 text-xs"}>
                不用模型,本地快速拆分
              </button>
            </>
          ) : (
            <button onClick={itGenerate} disabled={itLoading || !itTopic.trim()}
              className="cursor-pointer rounded-lg border-none bg-indigo py-[11px] text-sm font-semibold tracking-[2px] text-white
                disabled:cursor-default disabled:opacity-50
                focus-visible:outline-2 focus-visible:outline-indigo focus-visible:outline-offset-2">
              {itLoading
                ? (refsLoading === "search" ? "查资料中…" : "生成中…")
                : (itRefNote.trim() ? "AI 仿写生成图文" : "AI 生成图文卡片")}
            </button>
          )}
          {itError && <div className="text-xs text-seal">{itError}</div>}
          {itNote && !itError && <div className="text-[11px] leading-relaxed text-ink-faint">{itNote}</div>}
        </section>
      </aside>

      {/* 右栏:卡片预览与导出 */}
      <section className="flex min-h-0 flex-col gap-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={sectionLabelCls}>卡片预览</span>
          {itCards && <span className="text-xs text-ink-faint">封面 + {itCards.pages.length} 页</span>}
          {/* AI 增强:标题打磨 / 发布文案(有卡片后可用) */}
          {itCards && (
            <>
              <button onClick={itGenTitles} disabled={itTitlesLoading || itLoading}
                className={btnCls + " rounded-2xl px-3 py-1.5 text-xs"}>
                {itTitlesLoading ? "构思中…" : "换个封面标题"}
              </button>
              <button onClick={itGenCaption} disabled={itCaptionLoading || itLoading}
                className={btnCls + " rounded-2xl px-3 py-1.5 text-xs"}>
                {itCaptionLoading ? "撰写中…" : "生成发布文案"}
              </button>
            </>
          )}
          <button onClick={itCopyText} disabled={!itCards}
            className={btnCls + " ml-auto rounded-2xl px-3.5 py-1.5 text-xs " +
              (itCopied ? "border-indigo bg-indigo-bg text-indigo" : "")}>
            {itCopied ? "已复制 ✓" : "复制全部文案"}
          </button>
          <button onClick={itExportAll} disabled={!itCards}
            className={btnCls + " rounded-2xl px-3.5 py-1.5 text-xs"}>
            下载全部图片
          </button>
        </div>

        {/* 封面标题候选:点击即替换封面 */}
        {itTitles.length > 0 && itCards && (
          <div className="rounded-[10px] border border-line bg-paper-deep px-3.5 py-3">
            <div className="mb-2 text-[11px] tracking-[2px] text-ink-faint">封面标题候选 · 点击替换</div>
            <div className="flex flex-wrap gap-1.5">
              {itTitles.map((t, i) => {
                const picked = itCards.cover.title === t;
                return (
                  <button key={i} onClick={() => itPickTitle(t)}
                    className={"cursor-pointer rounded-full border px-3 py-1.5 text-xs transition-all " +
                      (picked ? "border-indigo bg-indigo-bg font-semibold text-indigo"
                        : "border-line bg-white text-ink hover:border-indigo hover:text-indigo")}>
                    {picked && "✓ "}{t}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 发布文案:发图时直接粘贴 */}
        {itCaption && (
          <div className="rounded-[10px] border border-line bg-paper-deep px-3.5 py-3">
            <div className="mb-1.5 flex items-center">
              <span className="text-[11px] tracking-[2px] text-ink-faint">发布文案(配图使用)</span>
              <button onClick={itCopyCaption}
                className={btnCls + " ml-auto rounded-full px-3 py-1 text-[11px] " +
                  (itCaptionCopied ? "border-indigo bg-indigo-bg text-indigo" : "")}>
                {itCaptionCopied ? "已复制 ✓" : "复制文案"}
              </button>
            </div>
            <div className="text-xs leading-[1.9] whitespace-pre-wrap text-ink">{itCaption}</div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto rounded-[10px] border border-line bg-white p-[18px]">
          {!itCards ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <div className="mb-2.5 font-serif text-xl tracking-[3px] text-ink-faint">还没有卡片</div>
                <div className="text-xs leading-loose text-ink-faint">
                  左侧粘贴文章或带入写作草稿<br />点「AI 拆分成卡片」生成封面与内容页
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap content-start gap-4">
              <CardPreview kind="cover" data={itCards} index={0} />
              {itCards.pages.map((p, i) => (
                <CardPreview key={i} kind="page" data={p} index={i} />
              ))}
            </div>
          )}
        </div>
        <div className="text-center text-[11px] text-ink-faint">
          导出为 {itRatio.w}×{itRatio.h} PNG · 发布前可在平台内再微调顺序
        </div>
      </section>
    </main>
  );
}
