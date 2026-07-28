import { useEffect, useState } from "react";
import { useApp } from "../store";
import { PLATFORMS } from "../lib/presets";
import { ACTION_CHOICES, ACTION_GROUPS, OPS, SKILL_ITEM_MAX, scopeLabels, describe } from "../lib/skills";
import { chipCls, btnCls, inputCls, sectionLabelCls } from "../ui";

// 作用域勾选:UI 上的一项可能对应多个 op(改写润色 = 6 个),所以要做组的展开与收拢
const expand = (id) => ACTION_GROUPS[id] || [id];
const isActionOn = (actions, choiceId) => !actions ? false : expand(choiceId).every(op => actions.includes(op));

function toggleAction(actions, choiceId) {
  const ops = expand(choiceId);
  const cur = actions || [];
  const on = isActionOn(actions, choiceId);
  const next = on ? cur.filter(o => !ops.includes(o)) : [...new Set([...cur, ...ops])];
  return next.length ? next : null; // 全不选 = 未声明 = 全适用
}

// 简介输入框留空时,把自动派生的那句放进 placeholder,让用户看得见"留空会变成什么"
const firstOr = (s, fallback) => describe(s) || fallback;

// 技能库:编写、管理、导入导出写作规范
export default function SkillsPage() {
  const {
    skills, platform, addSkill, updateSkill, toggleSkill, removeSkill,
    importSkills, resetBuiltinSkill, restoreBuiltinSkills, hasDeletedBuiltins,
    exportSkillMd, selectSkills,
  } = useApp();

  const [selectedId, setSelectedId] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fileEl, setFileEl] = useState(null);

  const mine = skills.filter(s => !s.builtin);
  const builtin = skills.filter(s => s.builtin);
  const cur = skills.find(s => s.id === selectedId) || null;

  // 选中项被删掉后自动落到第一条,避免右栏空白
  useEffect(() => {
    if (!cur && skills.length) setSelectedId(skills[0].id);
  }, [skills, cur]);
  useEffect(() => { setConfirmDel(false); setCopied(false); }, [selectedId]);

  // 这条技能此刻会不会生效:把作用域从抽象规则变成一句人话
  const liveNote = (() => {
    if (!cur) return "";
    if (!cur.enabled) return "未启用 · 不会注入";
    const ops = cur.actions || Object.keys(OPS).filter(o => o !== "check" && o !== "manual");
    const okPlat = !cur.platforms || cur.platforms.includes(platform.id);
    if (!okPlat) {
      const names = cur.platforms.map(p => PLATFORMS.find(x => x.id === p)?.name || p).join("、");
      return `当前是${platform.name},这条只在${names}时生效`;
    }
    const hit = selectSkills(skills, { op: ops[0], platformId: platform.id }).used.some(s => s.id === cur.id);
    const opName = OPS[ops[0]] || ops[0];
    return hit ? `会在「${platform.name} · ${opName}」等场景注入`
      : `命中作用域,但超出注入预算,当前不会注入`;
  })();

  return (
    <main className="mx-auto box-border grid w-full max-w-[1440px] min-h-0 flex-1 grid-cols-[260px_1fr] gap-8 px-7 pt-6 pb-7">

      {/* ===== 左:技能列表 ===== */}
      <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
        <div className="flex gap-2">
          <button onClick={() => setSelectedId(addSkill())}
            className={btnCls + " flex-1 rounded-full px-3 py-[6px] text-xs"}>+ 新建</button>
          <button onClick={() => fileEl?.click()}
            className={btnCls + " rounded-full px-3 py-[6px] text-xs"}>导入 .md</button>
          <input ref={setFileEl} type="file" accept=".md,.txt,.markdown" multiple className="hidden"
            onChange={e => { importSkills(e.target.files); e.target.value = ""; }} />
        </div>

        {[["我的技能", mine], ["内置技能", builtin]].map(([label, list]) => list.length > 0 && (
          <section key={label}>
            <div className={sectionLabelCls + " mb-2"}>{label} · {list.length}</div>
            <div className="flex flex-col gap-1.5">
              {list.map(s => {
                const off = s.platforms && !s.platforms.includes(platform.id);
                return (
                  <button key={s.id} onClick={() => setSelectedId(s.id)}
                    className={chipCls(s.id === selectedId) + " px-2.5 py-2 " + (off ? "opacity-55" : "")}>
                    <div className="flex items-baseline gap-1.5">
                      {/* 勾选框自绘:整卡是选中态,这里单独接开关,所以要 stopPropagation */}
                      <span role="checkbox" aria-checked={s.enabled} tabIndex={0}
                        onClick={e => { e.stopPropagation(); toggleSkill(s.id); }}
                        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); toggleSkill(s.id); } }}
                        className={"mt-0.5 flex h-3.5 w-3.5 shrink-0 cursor-pointer items-center justify-center rounded-[3px] text-[9px] text-white " +
                          (s.enabled ? "border-[1.5px] border-indigo bg-indigo" : "border-[1.5px] border-ink-faint bg-transparent")}>
                        {s.enabled ? "✓" : ""}
                      </span>
                      <span className={"min-w-0 flex-1 truncate text-[13px] font-semibold " + (s.enabled ? "text-indigo" : "text-ink")}>
                        {s.name}
                      </span>
                    </div>
                    {describe(s) && (
                      <div className="mt-1 line-clamp-2 text-[11px] leading-normal text-ink-faint">{describe(s)}</div>
                    )}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {scopeLabels(s).map(b => (
                        <span key={b} className="rounded-full bg-paper-deep px-1.5 py-px text-[10px] text-ink-faint">{b}</span>
                      ))}
                      {s.edited && <span className="rounded-full bg-paper-deep px-1.5 py-px text-[10px] text-ink-faint">已修改</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ))}

        {hasDeletedBuiltins && (
          <button onClick={restoreBuiltinSkills} className={btnCls + " rounded-full px-3 py-[6px] text-xs"}>
            恢复被删除的内置技能
          </button>
        )}
      </aside>

      {/* ===== 右:编辑器 ===== */}
      <section className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        {!cur ? (
          <div className="m-auto p-10 text-center">
            <div className="mb-3 font-serif text-[22px] tracking-[3px] text-ink-faint">还没有技能</div>
            <div className="text-[13px] leading-loose text-ink-faint">
              技能是叠加在生成之上的写作规范,决定 AI 怎么写<br />
              点左上角「新建」写一条,或导入现成的 .md
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <input value={cur.name} onChange={e => updateSkill(cur.id, { name: e.target.value })}
                className="min-w-0 flex-1 border-none bg-transparent font-serif text-lg font-bold tracking-[1px] text-ink" />
              <span className="shrink-0 text-[11px] text-ink-faint">{liveNote}</span>
            </div>

            <input value={cur.description} onChange={e => updateSkill(cur.id, { description: e.target.value })}
              placeholder={firstOr(cur, "一句话说明这条技能干什么(留空会自动取正文首段)")}
              className={inputCls + " font-sans"} />

            <div className="rounded-[10px] border border-line bg-white p-3.5">
              <div className={sectionLabelCls + " mb-2"}>适用平台</div>
              <div className="flex flex-wrap gap-1.5">
                {PLATFORMS.map(p => {
                  const on = !!cur.platforms?.includes(p.id);
                  return (
                    <button key={p.id}
                      onClick={() => {
                        const next = on ? (cur.platforms || []).filter(x => x !== p.id) : [...(cur.platforms || []), p.id];
                        updateSkill(cur.id, { platforms: next.length ? next : null });
                      }}
                      className={chipCls(on) + " px-2.5 py-1 text-xs " + (on ? "text-indigo" : "text-ink-soft")}>
                      {p.name}
                    </button>
                  );
                })}
              </div>

              <div className={sectionLabelCls + " mt-3.5 mb-2"}>适用操作</div>
              <div className="flex flex-wrap gap-1.5">
                {ACTION_CHOICES.map(c => {
                  const on = isActionOn(cur.actions, c.id);
                  return (
                    <button key={c.id} onClick={() => updateSkill(cur.id, { actions: toggleAction(cur.actions, c.id) })}
                      className={chipCls(on) + " px-2.5 py-1 text-xs " + (on ? "text-indigo" : "text-ink-soft")}>
                      {c.name}
                    </button>
                  );
                })}
              </div>

              <div className="mt-2.5 text-[11px] leading-relaxed text-ink-faint">
                都不选 = 不限。留空最省心:平台不限就在所有平台生效,操作不限就在除「发布前检查」外的所有环节生效。
              </div>
            </div>

            <div className="relative flex min-h-[220px] flex-1 flex-col rounded-[10px] border border-line bg-white">
              <textarea value={cur.content} onChange={e => updateSkill(cur.id, { content: e.target.value })}
                spellCheck={false}
                placeholder="写下写作规范。好技能的四件套:可数的硬约束、具体的禁用词清单、正例反例配对、输出前自检。"
                className="box-border min-h-[200px] w-full flex-1 resize-none rounded-[10px] border-none bg-transparent px-4 py-3.5 font-sans text-[13px] leading-relaxed text-ink" />
              <div className="pointer-events-none absolute right-3 bottom-2 text-[11px] text-ink-faint">
                {cur.content.length} / {SKILL_ITEM_MAX} 字符
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => { navigator.clipboard?.writeText(cur.content).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1600); }}
                className={btnCls + " rounded-full px-3 py-1 text-xs " + (copied ? "border-indigo bg-indigo-bg text-indigo" : "")}>
                {copied ? "已复制 ✓" : "复制正文"}
              </button>
              <button onClick={() => exportSkillMd(cur)} className={btnCls + " rounded-full px-3 py-1 text-xs"}>
                导出 .md
              </button>
              {cur.builtin && cur.edited && (
                <button onClick={() => resetBuiltinSkill(cur.id)} className={btnCls + " rounded-full px-3 py-1 text-xs"}>
                  还原为默认
                </button>
              )}
              {/* 删除用墨色不用印泥红:红色锁死在写作页「落笔」按钮上 */}
              {confirmDel ? (
                <button onClick={() => { removeSkill(cur.id); setConfirmDel(false); }} onBlur={() => setConfirmDel(false)}
                  className="ml-auto cursor-pointer rounded-full border border-ink bg-ink px-3 py-1 text-xs text-white transition-opacity hover:opacity-80">
                  {cur.builtin ? "确认删除?可再恢复" : "确认删除?"}
                </button>
              ) : (
                <button onClick={() => setConfirmDel(true)} className={btnCls + " ml-auto rounded-full px-3 py-1 text-xs"}>
                  删除
                </button>
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
