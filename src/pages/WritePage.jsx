import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../store";
import { MODELS } from "../lib/api";
import { PLATFORMS, TONES, QUICK_ACTIONS, INLINE_ACTIONS, customAction } from "../lib/presets";
import { scopeLabels, describe } from "../lib/skills";
import Fold from "../components/Fold";
import SelectionToolbar from "../components/SelectionToolbar";
import ContextMenu from "../components/ContextMenu";
import AcceptBar from "../components/AcceptBar";
import { measureRange } from "../lib/textareaRect";
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
    skills, skillSummary, skillPlan, toggleSkill, skillAction,
  } = useApp();
  const [modelMenuOpen, setModelMenuOpen] = useState(false); // 主题卡片里的模型下拉菜单
  const [sel, setSel] = useState(null);         // 正文选区 {start,end}|null
  const [anchor, setAnchor] = useState(null);   // 浮条/接受条锚点(正文卡片相对坐标)
  const [menu, setMenu] = useState(null);       // 右键菜单 {x,y}(视口坐标)|null
  const [pending, setPending] = useState(null); // 正在被 AI 改写的选区 {start,end,baseLen}
  const [accept, setAccept] = useState(null);   // 改写完成待确认的新范围 {start,end}
  const [hl, setHl] = useState(null);           // 自绘选区高亮 {box, rects}(卡片相对)
  const [focused, setFocused] = useState(false);
  const [scrollTick, setScrollTick] = useState(0); // 正文滚动后强制重算坐标
  const editorRef = useRef(null);
  const cardRef = useRef(null);
  const fileInputRef = useRef(null);
  const kbRef = useRef(null);
  const busy = loading !== null;
  const selCount = sel ? sel.end - sel.start : 0;

  // 从 textarea 读权威选区(失焦后 selectionStart/End 仍保留)
  const readSelection = () => {
    const el = editorRef.current;
    if (!el || el.selectionStart >= el.selectionEnd) return null;
    return { start: el.selectionStart, end: el.selectionEnd };
  };

  // onSelect 在拖动过程中会连发:只更新选区本身,不动锚点,浮条才不会跟着鼠标抖
  const syncSel = () => setSel(readSelection());

  // 一次测量,同时喂给浮条和高亮:把视口坐标换算成正文卡片(relative)内的坐标
  const layout = (range) => {
    const el = editorRef.current, card = cardRef.current;
    if (!el || !card) return;
    const m = measureRange(el, range.start, range.end);
    if (!m) { setAnchor(null); setHl(null); return; }
    // absolute 子元素以卡片的 padding box 为原点,而 getBoundingClientRect 给的是 border box,
    // 不扣掉 clientLeft/Top(即边框宽度)整层会偏 1px——高亮贴不住字就是这么来的
    const r = card.getBoundingClientRect();
    const c = { left: r.left + card.clientLeft, top: r.top + card.clientTop };

    // 浮条默认贴选区首行上方;顶部装不下就翻到末行下方;最后夹进可视区,保证永远点得到
    const H = 38;
    let y = m.first.top - H - 8;
    if (y < m.viewTop) y = m.last.bottom + 8;
    y = Math.max(m.viewTop + 4, Math.min(y, m.viewBottom - H - 4));
    setAnchor({
      x: (m.first.left + m.first.right) / 2 - c.left,
      y: y - c.top,
      endX: m.last.left - c.left,
      endY: Math.min(m.last.bottom + 6, m.viewBottom - 34) - c.top,
    });

    // 高亮层本身就是 textarea 的可视框 + overflow-hidden,滚出去的部分自动被裁掉。
    // 上下各撑 3px:rect 贴的是字形盒(15px 字在 loose 行高里只占一半),不撑开像条下划线
    const PAD = 3;
    setHl({
      box: { x: m.viewLeft - c.left, y: m.viewTop - c.top, w: m.viewWidth, h: m.viewBottom - m.viewTop },
      rects: m.rects.map(r => ({
        x: r.left - m.viewLeft, y: r.top - m.viewTop - PAD, w: r.width, h: r.height + PAD * 2,
      })),
    });
  };

  // 抬手/松键后才重算锚点,即浮条落位
  const syncAnchor = () => {
    const s = readSelection();
    setSel(s);
    if (!s) { setAnchor(null); setHl(null); return; }
    layout(s);
  };

  // 需要自绘高亮的两种情形:AI 正在改这段;或有选区但编辑器失焦(此时浏览器不画原生选区,
  // 用户点了菜单里的输入框会以为选区丢了)
  const hlRange = pending
    ? { start: pending.start, end: pending.end + (content.length - pending.baseLen) }
    : (sel && !focused ? sel : null);

  // 流式改写时 content 每帧都在变,用 rAF 把测量压到每帧最多一次
  useLayoutEffect(() => {
    if (!hlRange) { if (!anchor) setHl(null); return; }
    const id = requestAnimationFrame(() => layout(hlRange));
    return () => cancelAnimationFrame(id);
  }, [content, pending, focused, sel, scrollTick]);

  // 局部改写闭环:runAction 内部已 try/catch,await 它就等于"这次改写结束了",
  // 返回值就是新片段本身——据它算新范围,不受 setContent 重渲染时机影响
  const runLocal = async (action, range) => {
    setMenu(null); setAccept(null);
    const scoped = range && action.mode !== "append";
    if (!scoped) { await runAction(action, null); return; }

    setPending({ ...range, baseLen: content.length });
    const text = await runAction(action, range);
    setPending(null);
    if (!text) return; // 请求失败或返回空,不该弹"保留/撤销"误导用户

    const next = { start: range.start, end: range.start + text.length };
    setAccept(next);
    const el = editorRef.current; // 选区改落到新范围,方便"再改一次";不主动抢焦点
    if (el && document.activeElement === el) el.setSelectionRange(next.start, next.end);
    setSel(next);
    requestAnimationFrame(() => layout(next));
  };

  // 撤销这次改写:栈顶就是本次的快照(busy 保证期间不会有别的 AI 操作插队)
  const undoRewrite = () => {
    const r = accept;
    setAccept(null);
    undoLast();
    requestAnimationFrame(() => { // 正文回退后偏移重新有效,把选区还给用户,方便换个操作再试
      const el = editorRef.current;
      if (el && r) { el.focus(); el.setSelectionRange(r.start, r.end); syncAnchor(); }
    });
  };

  // 快捷键:store 的函数每次 render 都是新引用,放进 deps 会每帧重绑监听,所以用 ref 镜像
  kbRef.current = (e) => {
    const mod = e.metaKey || e.ctrlKey;
    const ae = document.activeElement;
    const inField = ae && (ae.tagName === "TEXTAREA" || ae.tagName === "INPUT");

    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); saveArticle(); return; }

    if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
      // Ctrl+Z 也是输入框的原生撤销。只在"刚做完 AI 改写、接受条还在"的时间窗内劫持
      // ——这恰好就是用户此刻心里想撤的那件事;其余时刻一律放行,手打的字照样能原生撤销。
      // 焦点不在输入框时没有原生行为可抢,兜底走 AI 撤销栈。
      if (accept) { e.preventDefault(); undoRewrite(); return; }
      if (!inField && canUndo) { e.preventDefault(); undoLast(); }
      return;
    }

    if (e.key === "Escape") { // 优先级:菜单 > 浮条 > 接受条
      if (menu) { setMenu(null); return; }
      if (anchor) { setAnchor(null); return; }
      if (accept) setAccept(null);
    }
  };
  useEffect(() => {
    const h = (e) => kbRef.current?.(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

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

        {/* 这里只做快速开关;编写/查看全文去 /skills(左栏 320px 塞不下编辑器) */}
        <Fold title="写作技能" summary={skillSummary}>
          <div className="flex flex-col gap-2">
            {skills.map(s => {
              // 作用域不匹配当前平台的降饱和 + 标注,把"为什么这条没生效"变成可见的
              const offPlatform = s.platforms && !s.platforms.includes(platform.id);
              const overBudget = skillPlan.dropped.some(d => d.id === s.id);
              const scope = scopeLabels(s);
              return (
                <div key={s.id} role="button" tabIndex={0}
                  onClick={() => toggleSkill(s.id)}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSkill(s.id); } }}
                  className={chipCls(s.enabled) + " px-3 py-[9px] " + (s.enabled && offPlatform ? "opacity-60" : "")}>
                  <div className="flex items-center gap-2">
                    <span role="checkbox" aria-checked={s.enabled}
                      className={"flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] text-[10px] text-white " +
                        (s.enabled ? "border-[1.5px] border-indigo bg-indigo" : "border-[1.5px] border-ink-faint bg-transparent")}>
                      {s.enabled ? "✓" : ""}
                    </span>
                    <span className={"min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold " +
                      (s.enabled ? "text-indigo" : "text-ink")}>{s.name}</span>
                    {s.builtin && (
                      <span className="shrink-0 rounded-[3px] border border-line px-[5px] py-px text-[10px] text-ink-faint">内置</span>
                    )}
                  </div>
                  {/* 副标题用 description 而不是截 content:导入的 SKILL.md 截出来是 frontmatter 残渣 */}
                  <div className="mt-[5px] line-clamp-2 text-[11px] leading-normal text-ink-faint">
                    {describe(s)}
                  </div>
                  {(scope.length > 0 || overBudget) && s.enabled && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {scope.map(b => (
                        <span key={b} className="rounded-full bg-paper-deep px-1.5 py-px text-[10px] text-ink-faint">{b}</span>
                      ))}
                      {overBudget && (
                        <span className="rounded-full bg-paper-deep px-1.5 py-px text-[10px] text-ink-faint">超预算未注入</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-2.5 flex items-center gap-2.5">
            <span className="flex-1 text-[11px] leading-relaxed text-ink-faint">
              技能按当前平台与操作自动生效
            </span>
            <button onClick={() => nav("/skills")}
              className={btnCls + " shrink-0 rounded-full px-3 py-1 text-xs"}>
              管理技能 →
            </button>
          </div>
        </Fold>
      </aside>

      {/* ===== 右栏:创作区(编辑卡片自动生长填满高度,超长时栏内滚动) ===== */}
      {/* 右键菜单是 fixed、不跟随栏内滚动,滚动时直接关掉,与系统右键菜单一致 */}
      <section onScroll={() => { if (menu) setMenu(null); }}
        className="flex min-h-0 flex-col gap-[18px] overflow-y-auto">

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
          {/* 顶部这排恒等于"整篇":选区操作已有浮条和右键菜单两个可见入口,
              同一个按钮不该再按有没有选区分裂成两种行为 */}
          {QUICK_ACTIONS.map(a => (
            <button key={a.id} onClick={() => runAction(a, null)} disabled={busy || !content}
              title={a.mode === "append" ? "接着结尾续写一段" : "改写整篇正文"}
              className={btnCls + " rounded-full px-3.5 py-[7px] text-[13px]"}>
              {loading === a.id ? "处理中…" : a.name}
            </button>
          ))}
          {selCount > 0 && (
            <span className="text-[11px] text-ink-faint">已选 {selCount} 字 · 用选区上的浮条只改这段</span>
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
        <div ref={cardRef} className="relative flex min-h-[200px] flex-1 flex-col rounded-[10px] border border-line bg-white">
          {/* 选区高亮:层本身 = textarea 可视框 + overflow-hidden,滚出可视区的色块自动被裁 */}
          {hl && hlRange && (
            <div aria-hidden style={{ left: hl.box.x, top: hl.box.y, width: hl.box.w, height: hl.box.h }}
              className="pointer-events-none absolute z-0 overflow-hidden">
              {hl.rects.map((r, i) => (
                <span key={i} style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
                  className={"absolute rounded-[2px] " + (pending ? "bg-indigo-bg" : "bg-indigo-bg/60")} />
              ))}
            </div>
          )}
          {/* 流式输出时不遮挡编辑器,让用户看到文字逐字落下;
              局部改写(pending)也不遮挡,否则关掉流式时高亮和浮条全被灰罩糊住 */}
          {busy && !pending && loading !== "titles" && loading !== "check" && loading !== "outline" && !(streamEnabled && content) && (
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
            /* z-[1]:定位元素默认画在静态元素之上,必须显式给层级,高亮色块才压得到文字底下 */
            <div className="relative z-[1] flex flex-1 flex-col">
              {/* 文章标题:居中 + 加粗 + 宋体大字号,与正文视觉区分 */}
              <input value={docTitle} onChange={e => setDocTitle(e.target.value)}
                placeholder="在此输入标题,或点「起5个标题」挑一个"
                spellCheck={false}
                className="box-border w-full border-none border-b border-line bg-transparent px-8 pt-[26px] pb-[18px] text-center font-serif text-[23px] font-bold tracking-[1px] text-ink
                  border-b-solid [border-bottom-width:1px]
                  placeholder:font-sans placeholder:text-sm placeholder:font-normal placeholder:tracking-normal placeholder:text-ink-faint" />
              <textarea ref={editorRef} value={content}
                onChange={e => { setContent(e.target.value); setAccept(null); syncSel(); }}
                onSelect={syncSel}
                onMouseDown={() => setAnchor(null)}
                onMouseUp={syncAnchor}
                onDoubleClick={syncAnchor}
                onKeyUp={e => { if (e.shiftKey || e.key.startsWith("Arrow")) syncAnchor(); }}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onScroll={() => setScrollTick(t => t + 1)}
                onContextMenu={e => {
                  if (e.shiftKey) return; // 逃生阀:Shift+右键 让给系统菜单(粘贴等)
                  if (busy) return;       // AI 忙时不接管,避免误触第二次操作
                  e.preventDefault();
                  const s = readSelection();
                  setSel(s);
                  if (s) layout(s);
                  setMenu({ x: e.clientX, y: e.clientY });
                }}
                className="box-border min-h-[120px] w-full flex-1 resize-none rounded-[10px] border-none bg-transparent px-8 pt-6 pb-7 font-sans text-[15px] leading-loose text-ink" />
            </div>
          )}

          {/* 改写中:选区旁的小胶囊,取代全屏遮罩(复用 index.css 已有的 .lb-loading) */}
          {pending && anchor && (
            <div style={{ left: anchor.x, top: anchor.y }}
              className="absolute z-20 -translate-x-1/2 rounded-full border border-line bg-white px-3 py-1
                         text-xs text-indigo shadow-[0_8px_24px_rgba(35,38,45,.12)]">
              <span className="lb-loading">改写中<span>。</span><span>。</span><span>。</span></span>
            </div>
          )}

          {anchor && sel && !busy && !menu && !accept && (
            <SelectionToolbar x={anchor.x} y={anchor.y} boxWidth={cardRef.current?.clientWidth || 0}
              actions={INLINE_ACTIONS} busy={busy}
              onAction={a => runLocal(a, sel)}
              onMore={() => {
                const el = cardRef.current, r = el.getBoundingClientRect(); // 菜单是 fixed,换回视口坐标
                setMenu({ x: r.left + el.clientLeft + anchor.x, y: r.top + el.clientTop + anchor.y + 30 });
              }} />
          )}

          {accept && anchor && (
            <AcceptBar x={anchor.endX} y={anchor.endY} boxWidth={cardRef.current?.clientWidth || 0}
              count={accept.end - accept.start}
              onKeep={() => setAccept(null)} onUndo={undoRewrite} />
          )}
        </div>

        <div className="text-center text-xs text-ink-faint">
          AI 生成的内容仅供参考,发布前请核实事实并加入你自己的观点
        </div>
      </section>

      {/* 右键菜单挂在滚动栏之外:fixed 弹层放进滚动/sticky 容器会被困住(踩过的坑) */}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} selCount={selCount} canUndo={canUndo} busy={busy}
          skills={skills.filter(s => s.enabled && (!s.platforms || s.platforms.includes(platform.id)))}
          onAction={a => runLocal(a, sel)}
          onCustom={t => runLocal(customAction(t), sel)}
          onSkill={s => runLocal(skillAction(s), sel)}
          onUndo={() => { setMenu(null); setAccept(null); undoLast(); }}
          onCopySel={() => {
            if (sel) navigator.clipboard?.writeText(content.slice(sel.start, sel.end)).catch(() => {});
            setMenu(null);
          }}
          onClose={() => setMenu(null)} />
      )}
    </main>
  );
}
