import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../store";
import { MODELS } from "../lib/api";
import { PLATFORMS, TONES, QUICK_ACTIONS } from "../lib/presets";
import Fold from "../components/Fold";
import { chipCls, btnCls, sectionLabelCls } from "../ui";

export default function WritePage() {
  const nav = useNavigate();
  const {
    platform, setPlatform, tone, setTone, topic, setTopic, content, setContent,
    docTitle, setDocTitle, titles, loading, error, copied,
    generate, runAction, genTitles, copyAll,
    savedFlash, saveArticle, exportCurrentMd, streamEnabled,
    canUndo, undoLast, checkReport, checkStale, runCheck, applyIssue, dismissIssue,
    outline, genOutline, writeFromOutline, clearOutline,
    updateOutlineItem, removeOutlineItem, addOutlineItem, moveOutlineItem,
    modelId, setModelId, customModel, setCustomModel, apiMode, setApiMode, modelSummary,
    customModels, customApiModel, setCustomApiModel,
    skills, skillSummary, importSkills, toggleSkill, removeSkill,
  } = useApp();
  const [modelMenuOpen, setModelMenuOpen] = useState(false); // 主题卡片里的模型下拉菜单
  const [selCount, setSelCount] = useState(0); // 正文选中字数,仅用于操作条提示
  const editorRef = useRef(null);
  const fileInputRef = useRef(null);
  const busy = loading !== null;

  // 点击快捷操作时从 textarea 读权威选区(失焦后 selectionStart/End 仍保留)
  const readSelection = () => {
    const el = editorRef.current;
    if (!el || el.selectionStart >= el.selectionEnd) return null;
    return { start: el.selectionStart, end: el.selectionEnd };
  };
  const syncSelCount = () => {
    const el = editorRef.current;
    setSelCount(el ? el.selectionEnd - el.selectionStart : 0);
  };

  return (
    <main className="mx-auto box-border grid w-full max-w-[1440px] min-h-0 flex-1 grid-cols-[320px_1fr] gap-8 px-7 pt-6 pb-7">

      {/* ===== 左栏:创作设置 ===== */}
      <aside className="flex min-h-0 flex-col gap-5 overflow-y-auto pr-1">
        <section>
          <div className={sectionLabelCls + " mb-2.5"}>发布平台</div>
          <div className="grid grid-cols-2 gap-2">
            {PLATFORMS.map(p => (
              <button key={p.id} onClick={() => setPlatform(p)}
                className={chipCls(platform.id === p.id) + " px-3 py-2.5"}>
                <div className={"text-sm font-semibold " + (platform.id === p.id ? "text-indigo" : "text-ink")}>{p.name}</div>
                <div className="mt-0.5 text-[11px] text-ink-faint">{p.tag}</div>
              </button>
            ))}
          </div>
          <div className="mt-2 text-[11px] leading-relaxed text-ink-faint">{platform.hint}</div>
        </section>

        <section>
          <div className={sectionLabelCls + " mb-2.5"}>语气风格</div>
          <div className="grid grid-cols-2 gap-2">
            {TONES.map(t => (
              <button key={t.id} onClick={() => setTone(t)} title={t.desc}
                className={chipCls(tone.id === t.id) + " px-3 py-2.5"}>
                <div className={"text-sm font-semibold " + (tone.id === t.id ? "text-indigo" : "text-ink")}>{t.name}</div>
                <div className="mt-0.5 text-[11px] text-ink-faint">{t.desc}</div>
              </button>
            ))}
          </div>
        </section>

        <Fold title="写作技能" summary={skillSummary}>
          <div className="flex flex-col gap-2">
            {skills.map(s => (
              <div key={s.id} role="button" tabIndex={0}
                onClick={() => toggleSkill(s.id)}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSkill(s.id); } }}
                className={chipCls(s.enabled) + " px-3 py-[9px]"}>
                <div className="flex items-center gap-2">
                  <span className={"flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] text-[10px] text-white " +
                    (s.enabled ? "border-[1.5px] border-indigo bg-indigo" : "border-[1.5px] border-ink-faint bg-transparent")}>
                    {s.enabled ? "✓" : ""}
                  </span>
                  <span className={"min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold " +
                    (s.enabled ? "text-indigo" : "text-ink")}>{s.name}</span>
                  {s.builtin ? (
                    <span className="shrink-0 rounded-[3px] border border-line px-[5px] py-px text-[10px] text-ink-faint">内置</span>
                  ) : (
                    <button onClick={e => { e.stopPropagation(); removeSkill(s.id); }} aria-label={`删除技能 ${s.name}`}
                      className="shrink-0 cursor-pointer border-none bg-transparent px-1 py-0.5 text-sm leading-none text-ink-faint">×</button>
                  )}
                </div>
                <div className="mt-[5px] line-clamp-2 text-[11px] leading-normal text-ink-faint">{s.content}</div>
              </div>
            ))}
          </div>
          <div className="mt-2.5 flex items-center gap-2.5">
            <span className="flex-1 text-[11px] leading-relaxed text-ink-faint">启用的技能会在每次生成时生效</span>
            <button onClick={() => fileInputRef.current?.click()}
              className={btnCls + " shrink-0 rounded-full px-3 py-1 text-xs"}>
              + 导入 .md / .txt
            </button>
            <input ref={fileInputRef} type="file" accept=".md,.txt,.markdown" multiple
              onChange={e => { importSkills(e.target.files); e.target.value = ""; }} className="hidden" />
          </div>
        </Fold>
      </aside>

      {/* ===== 右栏:创作区(编辑卡片自动生长填满高度,超长时栏内滚动) ===== */}
      <section className="flex min-h-0 flex-col gap-[18px] overflow-y-auto">

        {/* 主题输入 + 落笔按钮 */}
        <div className="flex items-stretch gap-3.5 rounded-[10px] border border-line bg-white p-[18px]">
          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            <textarea value={topic} onChange={e => setTopic(e.target.value)}
              placeholder={`想写什么?比如:「打工人如何用碎片时间自我提升」\n写下主题、关键词,或粘贴一段素材……`}
              rows={2}
              className="resize-none border-none bg-transparent font-sans text-[15px] leading-[1.7] text-ink" />

            {/* 模型选择:下拉菜单,自定义接入跳设置页 */}
            <div className="relative flex items-center">
              <button onClick={() => setModelMenuOpen(o => !o)} aria-expanded={modelMenuOpen}
                className={btnCls + " flex items-center gap-1.5 rounded-full px-3 py-[5px] text-xs"}>
                <span className="text-ink-faint">模型</span>
                <span className="font-semibold text-ink">{modelSummary}</span>
                <span className="text-[9px]">▾</span>
              </button>

              {modelMenuOpen && (
                <>
                  <div onClick={() => setModelMenuOpen(false)} className="fixed inset-0 z-30" />
                  <div className="absolute top-[calc(100%+6px)] left-0 z-31 w-[300px] rounded-lg border border-line bg-white p-1.5 shadow-[0_8px_24px_rgba(35,38,45,.12)]">
                    {MODELS.map(m => {
                      const active = apiMode === "builtin" && modelId === m.id;
                      return (
                        <button key={m.id}
                          onClick={() => { setApiMode("builtin"); setModelId(m.id); if (m.id !== "__custom__") setModelMenuOpen(false); }}
                          className={"flex w-full cursor-pointer items-baseline gap-2 rounded-md border-none px-2.5 py-2 text-left transition-colors hover:bg-indigo-bg " +
                            (active ? "bg-indigo-bg" : "bg-transparent")}>
                          <span className={"text-[13px] font-semibold " + (active ? "text-indigo" : "text-ink")}>{m.name}</span>
                          <span className="text-[11px] text-ink-faint">{m.desc}</span>
                          {active && <span className="ml-auto text-xs text-indigo">✓</span>}
                        </button>
                      );
                    })}
                    {apiMode === "builtin" && modelId === "__custom__" && (
                      <div className="px-2.5 pt-0.5 pb-2">
                        <input value={customModel} onChange={e => setCustomModel(e.target.value)}
                          placeholder="输入模型名称,回车确认" spellCheck={false} autoFocus
                          onKeyDown={e => { if (e.key === "Enter") setModelMenuOpen(false); }}
                          className="box-border w-full rounded-md border border-line bg-white px-2.5 py-[7px] font-mono text-xs text-ink" />
                      </div>
                    )}
                    {/* 自定义接入的模型列表:点击即切到该模型(多模型快速切换) */}
                    {customModels.length > 0 && (
                      <>
                        <div className="mx-1 my-1.5 h-px bg-line" />
                        <div className="px-2.5 pt-1 pb-0.5 text-[10px] tracking-[2px] text-ink-faint">自定义接入</div>
                        {customModels.map(m => {
                          const active = apiMode === "custom" && customApiModel === m;
                          return (
                            <button key={m}
                              onClick={() => { setApiMode("custom"); setCustomApiModel(m); setModelMenuOpen(false); }}
                              className={"flex w-full cursor-pointer items-baseline gap-2 rounded-md border-none px-2.5 py-2 text-left transition-colors hover:bg-indigo-bg " +
                                (active ? "bg-indigo-bg" : "bg-transparent")}>
                              <span className={"font-mono text-[13px] font-semibold " + (active ? "text-indigo" : "text-ink")}>{m}</span>
                              {active && <span className="ml-auto text-xs text-indigo">✓</span>}
                            </button>
                          );
                        })}
                      </>
                    )}
                    <div className="mx-1 my-1.5 h-px bg-line" />
                    <button onClick={() => { setModelMenuOpen(false); nav("/settings"); }}
                      className={"flex w-full cursor-pointer items-baseline gap-2 rounded-md border-none px-2.5 py-2 text-left transition-colors hover:bg-indigo-bg " +
                        (apiMode === "custom" ? "bg-indigo-bg" : "bg-transparent")}>
                      <span className={"text-[13px] font-semibold " + (apiMode === "custom" ? "text-indigo" : "text-ink")}>自定义接入…</span>
                      <span className="text-[11px] text-ink-faint">{apiMode === "custom" ? "生效中 · 去设置页修改" : "去设置页配置"}</span>
                      {apiMode === "custom" && <span className="ml-auto text-xs text-indigo">✓</span>}
                    </button>
                  </div>
                </>
              )}

              {/* 大纲先行:长文先出结构再成文 */}
              <button onClick={genOutline} disabled={busy || !topic.trim()}
                title="先让 AI 列出小节结构,确认后再成文"
                className={btnCls + " ml-2 rounded-full px-3 py-[5px] text-xs"}>
                {loading === "outline" ? "构思大纲…" : "先列大纲"}
              </button>
            </div>
          </div>

          {/* 印泥红只用在这一个主按钮上 */}
          <button onClick={generate} disabled={busy}
            className="w-[76px] cursor-pointer rounded-lg border-none bg-seal font-serif text-lg font-bold tracking-[3px] text-white [writing-mode:vertical-rl] transition-all
              enabled:hover:bg-seal-dark enabled:active:scale-[.97] disabled:cursor-default disabled:opacity-50
              focus-visible:outline-2 focus-visible:outline-indigo focus-visible:outline-offset-2">
            {loading === "gen" ? "落墨中" : "落 笔"}
          </button>
        </div>

        {error && <div className="px-1 text-[13px] text-seal">{error}</div>}

        {/* 快捷操作条 */}
        <div className="flex flex-wrap items-center gap-2">
          {QUICK_ACTIONS.map(a => (
            <button key={a.id} onClick={() => runAction(a, readSelection())} disabled={busy || !content}
              title={a.mode === "append" ? "接着结尾续写一段" : (selCount > 0 ? `只${a.name.slice(0, 2)}选中的 ${selCount} 字` : undefined)}
              className={btnCls + " rounded-full px-3.5 py-[7px] text-[13px]"}>
              {loading === a.id ? "处理中…" : a.name}
            </button>
          ))}
          {selCount > 0 && (
            <span className="text-[11px] text-indigo">已选 {selCount} 字 · 操作只改选中段</span>
          )}
          <div className="mx-1 h-[18px] w-px bg-line" />
          {canUndo && (
            <button onClick={undoLast} disabled={busy} title="回退上一次 AI 修改"
              className={btnCls + " rounded-full px-3.5 py-[7px] text-[13px]"}>
              ↩ 撤销
            </button>
          )}
          <button onClick={genTitles} disabled={busy || (!content && !topic)}
            className={btnCls + " rounded-full px-3.5 py-[7px] text-[13px]"}>
            {loading === "titles" ? "构思中…" : "起5个标题"}
          </button>
          <button onClick={runCheck} disabled={busy || !content}
            title="AI 检查违禁词风险、错别字与存疑表述"
            className={btnCls + " rounded-full px-3.5 py-[7px] text-[13px]"}>
            {loading === "check" ? "检查中…" : "发布前检查"}
          </button>
          <button onClick={saveArticle} disabled={!content && !docTitle}
            className={btnCls + " ml-auto rounded-full px-3.5 py-[7px] text-[13px] " +
              (savedFlash ? "border-indigo bg-indigo-bg text-indigo" : "")}>
            {savedFlash ? "已保存 ✓" : "保存"}
          </button>
          <button onClick={exportCurrentMd} disabled={!content && !docTitle}
            className={btnCls + " rounded-full px-3.5 py-[7px] text-[13px]"}>
            导出 .md
          </button>
          <button onClick={copyAll} disabled={!content}
            className={btnCls + " rounded-full px-3.5 py-[7px] text-[13px] " +
              (copied ? "border-indigo bg-indigo-bg text-indigo" : "")}>
            {copied ? "已复制 ✓" : "复制全文"}
          </button>
        </div>

        {/* 写作大纲:可增删改与调序,确认后按大纲成文 */}
        {outline.length > 0 && (
          <div className="rounded-[10px] border border-line bg-paper-deep p-4">
            <div className="flex items-center gap-2.5">
              <span className={sectionLabelCls}>写作大纲 · {outline.length} 小节</span>
              <span className="text-[11px] text-ink-faint">可直接编辑、调序、增删</span>
              <button onClick={clearOutline} className={btnCls + " ml-auto shrink-0 rounded-full px-3 py-1 text-xs"}>
                清空
              </button>
              <button onClick={writeFromOutline} disabled={busy}
                className="shrink-0 cursor-pointer rounded-full border-none bg-indigo px-3.5 py-1 text-xs text-white transition-opacity enabled:hover:opacity-85 disabled:cursor-default disabled:opacity-45">
                {loading === "gen" ? "成文中…" : "按大纲成文"}
              </button>
            </div>

            <div className="mt-2.5 flex flex-col gap-2">
              {outline.map((s, i) => (
                <div key={i} className="flex items-start gap-2 rounded-md border border-line bg-white px-3 py-2.5">
                  <span className="mt-1 shrink-0 font-serif text-[13px] text-ink-faint">{i + 1}</span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <input value={s.heading} onChange={e => updateOutlineItem(i, { heading: e.target.value })}
                      placeholder="小节标题"
                      className="w-full border-none bg-transparent font-sans text-[13px] font-semibold text-ink placeholder:font-normal placeholder:text-ink-faint" />
                    <input value={s.note} onChange={e => updateOutlineItem(i, { note: e.target.value })}
                      placeholder="这一节要写什么"
                      className="w-full border-none bg-transparent font-sans text-[11px] leading-relaxed text-ink-soft placeholder:text-ink-faint" />
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button onClick={() => moveOutlineItem(i, -1)} disabled={i === 0} aria-label="上移"
                      className="cursor-pointer border-none bg-transparent px-1 text-[11px] text-ink-faint disabled:opacity-30">↑</button>
                    <button onClick={() => moveOutlineItem(i, 1)} disabled={i === outline.length - 1} aria-label="下移"
                      className="cursor-pointer border-none bg-transparent px-1 text-[11px] text-ink-faint disabled:opacity-30">↓</button>
                    <button onClick={() => removeOutlineItem(i)} aria-label="删除小节"
                      className="cursor-pointer border-none bg-transparent px-1 text-sm leading-none text-ink-faint">×</button>
                  </div>
                </div>
              ))}
            </div>

            <button onClick={addOutlineItem} className={btnCls + " mt-2 rounded-full px-3 py-1 text-xs"}>
              + 添加小节
            </button>
          </div>
        )}

        {/* 标题候选 */}
        {titles.length > 0 && (
          <div className="rounded-[10px] border border-line bg-paper-deep p-4">
            <div className={sectionLabelCls + " mb-2.5"}>标题候选 · 点击设为标题</div>
            <div className="flex flex-col gap-2">
              {titles.map((t, i) => {
                const picked = docTitle === t;
                return (
                  <button key={i} onClick={() => setDocTitle(picked ? "" : t)}
                    className={"cursor-pointer rounded-md border px-3.5 py-2.5 text-left text-sm leading-normal transition-all hover:border-indigo hover:bg-indigo-bg " +
                      (picked ? "border-indigo bg-indigo-bg font-semibold text-indigo" : "border-line bg-white font-normal text-ink")}>
                    <span className={"mr-2.5 font-serif " + (picked ? "text-indigo" : "text-ink-faint")}>{"一二三四五"[i]}</span>{t}
                    {picked && <span className="float-right text-xs">✓ 已选用</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 发布前检查报告 */}
        {checkReport && (
          <div className="rounded-[10px] border border-line bg-paper-deep p-4">
            <div className="flex items-center gap-2.5">
              <span className={sectionLabelCls}>发布前检查</span>
              <span className={"font-serif text-lg font-bold " + (checkReport.score >= 80 ? "text-indigo" : "text-ink")}>
                {checkReport.score}
              </span>
              <span className="text-[11px] text-ink-faint">/ 100 安全分</span>
              <span className="min-w-0 flex-1 truncate text-xs text-ink-soft">{checkReport.summary}</span>
              {checkStale && (
                <span className="shrink-0 text-[11px] text-ink-faint">正文已修改,建议重新检查</span>
              )}
              <button onClick={runCheck} disabled={busy}
                className={btnCls + " shrink-0 rounded-full px-3 py-1 text-xs"}>
                {loading === "check" ? "检查中…" : "重新检查"}
              </button>
            </div>

            {checkReport.issues.filter(i => !i.dismissed).length === 0 ? (
              <div className="mt-2.5 text-[13px] text-ink-soft">未发现需要处理的问题,可以放心发布。</div>
            ) : (
              <div className="mt-2.5 flex flex-col gap-2">
                {checkReport.issues.map((issue, idx) => issue.dismissed ? null : (
                  <div key={idx} className={"rounded-md border border-line bg-white px-3 py-2.5 " + (issue.applied ? "opacity-55" : "")}>
                    <div className="flex items-baseline gap-2">
                      <span className={"shrink-0 rounded-[3px] border px-[5px] py-px text-[10px] " +
                        (issue.severity === "high" ? "border-ink bg-ink text-white"
                          : issue.severity === "mid" ? "border-ink-soft text-ink-soft"
                          : "border-line text-ink-faint")}>
                        {{ risk: "风险", typo: "错别字", fact: "存疑" }[issue.type]}
                        {issue.severity === "high" ? " · 高" : issue.severity === "mid" ? " · 中" : ""}
                      </span>
                      <span className="min-w-0 flex-1 text-[13px] leading-relaxed text-ink">
                        「<span className="text-ink-soft">{issue.excerpt}</span>」{issue.reason}
                      </span>
                    </div>
                    {issue.suggestion && !issue.applied && (
                      <div className="mt-1.5 flex items-center gap-2 pl-1">
                        <span className="min-w-0 flex-1 text-xs text-indigo">建议改为:{issue.suggestion}</span>
                        {issue.lost ? (
                          <span className="shrink-0 text-[11px] text-ink-faint">原文已修改,未能定位</span>
                        ) : (
                          <button onClick={() => applyIssue(idx)}
                            className={btnCls + " shrink-0 rounded-full px-2.5 py-0.5 text-[11px]"}>
                            应用
                          </button>
                        )}
                        <button onClick={() => dismissIssue(idx)}
                          className={btnCls + " shrink-0 rounded-full px-2.5 py-0.5 text-[11px]"}>
                          忽略
                        </button>
                      </div>
                    )}
                    {issue.applied && <div className="mt-1 pl-1 text-[11px] text-indigo">已应用建议 ✓</div>}
                    {!issue.suggestion && !issue.applied && (
                      <div className="mt-1 flex items-center pl-1">
                        <span className="flex-1" />
                        <button onClick={() => dismissIssue(idx)}
                          className={btnCls + " shrink-0 rounded-full px-2.5 py-0.5 text-[11px]"}>
                          忽略
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 正文编辑区 */}
        <div className="relative flex min-h-[200px] flex-1 flex-col rounded-[10px] border border-line bg-white">
          {/* 流式输出时不遮挡编辑器,让用户看到文字逐字落下 */}
          {busy && loading !== "titles" && loading !== "check" && loading !== "outline" && !(streamEnabled && content) && (
            <div className="absolute inset-0 z-[5] flex items-center justify-center rounded-[10px] bg-[rgba(250,249,245,.86)]">
              <div className="lb-loading font-serif text-lg tracking-[4px] text-ink-soft">
                笔尖游走<span>。</span><span>。</span><span>。</span>
              </div>
            </div>
          )}
          {!content && !docTitle && !busy ? (
            <div className="m-auto p-10 text-center">
              <div className="mb-3 font-serif text-[22px] tracking-[3px] text-ink-faint">纸上空空,正待落笔</div>
              <div className="text-[13px] leading-loose text-ink-faint">
                在上方写下主题,选好平台与语气,点「落笔」<br />
                生成后可以直接编辑,也可以一键换写法、扩写、精简、润色
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col">
              {/* 文章标题:居中 + 加粗 + 宋体大字号,与正文视觉区分 */}
              <input value={docTitle} onChange={e => setDocTitle(e.target.value)}
                placeholder="在此输入标题,或点「起5个标题」挑一个"
                spellCheck={false}
                className="box-border w-full border-none border-b border-line bg-transparent px-8 pt-[26px] pb-[18px] text-center font-serif text-[23px] font-bold tracking-[1px] text-ink
                  border-b-solid [border-bottom-width:1px]
                  placeholder:font-sans placeholder:text-sm placeholder:font-normal placeholder:tracking-normal placeholder:text-ink-faint" />
              <textarea ref={editorRef} value={content}
                onChange={e => { setContent(e.target.value); syncSelCount(); }}
                onSelect={syncSelCount}
                className="box-border min-h-[120px] w-full flex-1 resize-none rounded-[10px] border-none bg-transparent px-8 pt-6 pb-7 font-sans text-[15px] leading-loose text-ink" />
            </div>
          )}
        </div>

        <div className="text-center text-xs text-ink-faint">
          AI 生成的内容仅供参考,发布前请核实事实并加入你自己的观点
        </div>
      </section>
    </main>
  );
}
