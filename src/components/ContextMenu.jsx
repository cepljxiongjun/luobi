import { useLayoutEffect, useRef, useState } from "react";
import { QUICK_ACTIONS } from "../lib/presets";
import { clampX } from "../lib/textareaRect";

const itemCls =
  "flex w-full cursor-pointer items-baseline gap-2 rounded-md border-none bg-transparent px-2.5 py-2 " +
  "text-left text-[13px] text-ink transition-colors enabled:hover:bg-indigo-bg disabled:opacity-45 disabled:cursor-default";

/**
 * 正文右键菜单。用 fixed + 鼠标视口坐标:菜单要能盖住右栏边界,
 * 且必须渲染在滚动/sticky 容器之外(sticky 会把弹层的 z-index 困住,项目踩过这个坑)。
 *
 * selCount === 0 表示没有选区 —— 菜单照常可用,只是作用域变成整篇正文,
 * 这与 runAction(action, null) 的既有语义天然一致,不需要任何特判。
 */
export default function ContextMenu({
  x, y, selCount, canUndo, busy, skills = [], onAction, onCustom, onSkill, onUndo, onCopySel, onClose,
}) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [skillOpen, setSkillOpen] = useState(false);
  const [text, setText] = useState("");
  const scoped = selCount > 0;

  // 打开后按实际尺寸收敛到视口内;下方放不下就朝上翻(和系统右键菜单一致)。
  // deps 带 customOpen:展开输入框会变高,需要重算
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    setPos({
      left: clampX(x, w, 8, window.innerWidth - 8),
      top: y + h > window.innerHeight - 8 ? Math.max(8, y - h) : y,
    });
  }, [x, y, customOpen, skillOpen]);

  const submitCustom = () => {
    if (!text.trim()) return;
    onCustom(text.trim());
  };

  return (
    <>
      {/* 与模型下拉同一范式:全屏透明层接管"点击外部关闭" */}
      <div onMouseDown={onClose}
        onContextMenu={e => { e.preventDefault(); onClose(); }}
        className="fixed inset-0 z-40" />
      <div ref={ref} role="menu"
        style={{ left: pos?.left ?? x, top: pos?.top ?? y, visibility: pos ? "visible" : "hidden" }}
        // 除输入框外一律不抢 textarea 焦点,保住原生选区
        onMouseDown={e => { if (e.target.tagName !== "INPUT") e.preventDefault(); }}
        className="fixed z-41 w-[228px] rounded-lg border border-line bg-white p-1.5
                   shadow-[0_8px_24px_rgba(35,38,45,.12)]">

        <div className="px-2.5 pt-1 pb-1.5 text-[10px] tracking-[2px] text-ink-faint">
          {scoped ? `已选 ${selCount} 字 · 只改这段` : "整篇正文"}
        </div>

        {QUICK_ACTIONS.map(a => (
          <button key={a.id} role="menuitem" disabled={busy} onClick={() => onAction(a)} className={itemCls}>
            <span className="font-semibold">{a.mode === "append" ? "续写(接到文末)" : a.name}</span>
          </button>
        ))}

        <div className="mx-1 my-1.5 h-px bg-line" />

        {/* 原地展开输入框,与模型下拉里「自定义模型名」同一交互范式 */}
        <button role="menuitem" disabled={busy} onClick={() => setCustomOpen(true)} className={itemCls}>
          <span className="font-semibold text-indigo">✎ 按我的要求改写…</span>
        </button>
        {customOpen && (
          <div className="px-2.5 pt-0.5 pb-2">
            <input value={text} onChange={e => setText(e.target.value)} autoFocus spellCheck={false}
              placeholder="例:改成更口语的语气,回车执行"
              onKeyDown={e => {
                if (e.key === "Enter") { e.preventDefault(); submitCustom(); }
                // Esc 只收起输入框,不关整个菜单;顺手拦住 window 上的全局 Esc
                if (e.key === "Escape") { e.stopPropagation(); setCustomOpen(false); }
              }}
              className="box-border w-full rounded-md border border-line bg-white px-2.5 py-[7px] text-xs text-ink
                         placeholder:text-ink-faint" />
          </div>
        )}

        {/* 点名调用:只用这一条技能改写,不叠加自动注入的那些(对应 Manual 档) */}
        {skills.length > 0 && (
          <>
            <button role="menuitem" disabled={busy} onClick={() => setSkillOpen(o => !o)} className={itemCls}>
              <span className="font-semibold text-indigo">⚡ 用技能改写…</span>
              <span className="ml-auto text-[10px] text-ink-faint">{skills.length}</span>
            </button>
            {skillOpen && skills.map(s => (
              <button key={s.id} role="menuitem" disabled={busy} onClick={() => onSkill(s)}
                title={s.description || undefined}
                className={itemCls + " pl-6 text-ink-soft"}>
                <span className="min-w-0 truncate">{s.name}</span>
              </button>
            ))}
          </>
        )}

        <div className="mx-1 my-1.5 h-px bg-line" />

        {scoped && (
          <button role="menuitem" onClick={onCopySel} className={itemCls}>复制选中</button>
        )}
        <button role="menuitem" disabled={!canUndo || busy} onClick={onUndo} className={itemCls}>
          ↩ 撤销上一步 AI 修改
        </button>

        {/* 逃生阀:剪贴板读取在 Firefox / Tauri WebView 上不可靠,粘贴交还给系统菜单 */}
        <div className="px-2.5 pt-1.5 pb-1 text-[10px] leading-relaxed text-ink-faint">
          Shift + 右键 唤起系统菜单
        </div>
      </div>
    </>
  );
}
