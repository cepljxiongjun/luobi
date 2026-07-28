// ============ 写作技能(Skills) ============
// 技能 = 一份写作规范文本,启用后注入到生成的提示词里。
//
// 设计取自 Claude Agent Skills(SKILL.md)与 Cursor Rules(.mdc):元数据驱动的条件激活。
// 区别在于落笔是**单次 prompt 而非 agent 循环**,没有"让模型先看清单再决定加载哪条"的回合,
// 所以把筛选时机从模型运行时提前到应用编译提示词时 —— 靠 platforms/actions 静态筛。
//
// 关键约定:**作用域字段缺省 = 全适用**。缺省本身就是 alwaysApply。
// 这样老的只有 name: 的技能文件行为与改造前逐字节一致,零迁移代码;
// 也不必再引入一个 alwaysApply 字段与既有的 enabled 开关打架。

import { PLATFORMS } from "./presets";

export { BUILTIN_SKILLS } from "./builtinSkills";
import { BUILTIN_SKILLS } from "./builtinSkills";

// 操作:技能可以声明只在其中某几个环节生效
export const OPS = {
  draft: "落笔成文",
  outline: "列大纲",
  title: "起标题",
  rewrite: "换写法", expand: "扩写", shorten: "精简", polish: "润色",
  continue: "续写", custom: "按要求改写",
  cards: "图文拆卡",
  caption: "发布文案",
  check: "发布前检查",
  manual: "点名调用",
};

// 动作组:6 个改写类操作在用户心智里是一件事,让人在 YAML 里手抄 6 个 id 是折磨,
// UI 上也只该出现「改写润色」一个勾选框
export const ACTION_GROUPS = { edit: ["rewrite", "expand", "shorten", "polish", "continue", "custom"] };

// 这两个 op 是 opt-in-only:必须显式列出才生效。
// check 是审稿不是写作——把"开头要有钩子"注进查违禁词的提示词里只会冲淡它的本职;
// manual 是用户已经点名了一条技能,再自动叠一堆进去必然打架。
export const OPT_IN_OPS = ["check", "manual"];

// UI 上给用户勾的操作项(动作组折叠成一项,manual 不暴露——点名调用不需要预先声明)
export const ACTION_CHOICES = [
  { id: "draft", name: "落笔成文" },
  { id: "outline", name: "列大纲" },
  { id: "title", name: "起标题" },
  { id: "edit", name: "改写润色" },
  { id: "cards", name: "图文拆卡" },
  { id: "caption", name: "发布文案" },
  { id: "check", name: "发布前检查" },
];

// ---- 预算 ----
// 用户自带 Key,技能块每次请求都要付钱,且不像 agent 那样能按需加载,所以上限要保守。
// 一条合格技能 300-900 字符,默认启用组实际注入约 2000,6000 给自建留出 4-5 条空间,
// 同时保证最坏情况下技能块也不超过一篇公众号正文的长度。
export const SKILL_BUDGET = 6000;   // 技能块总字符上限
export const SKILL_MAX = 8;         // 同时生效条数上限
export const SKILL_ITEM_MAX = 4000; // 单条存储上限(维持改造前的行为)
export const SKILL_COUNT_MAX = 50;  // 用户自建技能条数上限
export const DESC_MAX = 200;
export const NAME_MAX = 30;

const PLATFORM_IDS = PLATFORMS.map(p => p.id);
const OP_IDS = Object.keys(OPS);

// ---- frontmatter 解析 ----

const FM_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;

// 双引号包裹的值走 JSON.parse,这样 serializeSkill 用 JSON.stringify 写出的转义
// (标题里的引号、反斜杠)能原样读回来;解析失败再退回朴素去引号
const unquote = (s) => {
  const t = String(s).trim();
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
    try { return JSON.parse(t); } catch { /* 落到下面 */ }
  }
  return t.replace(/^["']|["']$/g, "").trim();
};

// 为什么不引 yaml 库:字段只有 5 个、值只有「标量 / 字符串数组」两种形状,规则封闭,
// 手写比拖一个依赖划算(与 mdfile.js 同一判断)
export function parseFrontmatter(src) {
  const text = String(src || "").replace(/\r\n/g, "\n");
  const m = FM_RE.exec(text);
  if (!m) return { fm: {}, body: text.trim() };

  const fm = {};
  const lines = m[1].split("\n");
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(lines[i]);
    if (!kv) continue; // 认不出的行忽略,不让一行毁掉整份文件
    const key = kv[1];
    const raw = kv[2].trim();
    if (raw === "") {
      // 块式数组:往下吃掉所有 "- item" 行。
      // 必须支持这种写法——Obsidian 的 properties 面板保存时会把内联数组重写成块式,
      // 只认内联的话用户在 Obsidian 里编辑一次,作用域就丢了
      const arr = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
        arr.push(unquote(lines[++i].replace(/^\s*-\s+/, "").trim()));
      }
      fm[key] = arr.length ? arr : "";
    } else if (raw.startsWith("[") && raw.endsWith("]")) {
      fm[key] = raw.slice(1, -1).split(",").map(s => unquote(s.trim())).filter(Boolean);
    } else {
      fm[key] = unquote(raw);
    }
  }
  return { fm, body: text.slice(m[0].length).trim() };
}

// 把 frontmatter 里的作用域列表收敛成可信数据。
// 非法 id 全被过滤光时**视为未声明**而不是"永不生效"——否则一个拼错的平台名
// 会让技能静默消失,那是最难排查的一类 bug
function cleanScope(value, valid, expandGroups) {
  if (!Array.isArray(value)) {
    if (typeof value === "string" && value.trim()) value = value.split(/[,，\s]+/);
    else return null;
  }
  let ids = value.map(v => String(v).trim().toLowerCase()).filter(Boolean);
  if (expandGroups) ids = ids.flatMap(id => ACTION_GROUPS[id] || [id]);
  const kept = [...new Set(ids.filter(id => valid.includes(id)))];
  return kept.length ? kept : null;
}

const firstParagraph = (body) => {
  const p = String(body || "").split(/\n\s*\n/).find(s => s.trim() && !/^#/.test(s.trim()));
  return (p || "").replace(/\s+/g, " ").trim().slice(0, 80);
};

// 展示用的简介:用户没写就现取正文首段。**在读取时派生而不是存下来** ——
// 存下来的话用户改了正文,简介还停在旧内容上,越用越对不上
export const describe = (s) => s?.description?.trim() || firstParagraph(s?.content);

// 把任意来源的原始对象收敛成一条可信技能;内容为空返回 null(调用方据此报"已跳过")
export function normalizeSkill(raw) {
  const content = String(raw?.content || "").trim().slice(0, SKILL_ITEM_MAX);
  if (!content) return null;
  const priority = Number(raw?.priority);
  return {
    id: raw.id || `sk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: String(raw.name || "未命名技能").trim().slice(0, NAME_MAX),
    description: String(raw.description || "").trim().slice(0, DESC_MAX),
    content,
    platforms: cleanScope(raw.platforms, PLATFORM_IDS, false),
    actions: cleanScope(raw.actions, OP_IDS, true),
    priority: Number.isFinite(priority) ? Math.min(100, Math.max(0, Math.round(priority))) : 50,
    builtin: !!raw.builtin,
    enabled: !!raw.enabled,
  };
}

// 解析导入的技能文件。兼容三种形态:落笔自己导出的、原样的 Agent Skills SKILL.md、纯文本
export function parseSkillFile(filename, text) {
  const { fm, body } = parseFrontmatter(text);
  // when_to_use 是 Agent Skills 用来给模型做运行时触发判断的字段。我们是静态筛选用不上它,
  // 但拼进 description 里,这样一份原样的 SKILL.md 导进来信息不丢
  const desc = [fm.description, fm.when_to_use].filter(Boolean).join(" ");
  return normalizeSkill({
    name: fm.name || filename.replace(/\.(md|txt|markdown)$/i, ""),
    description: desc,
    content: body,
    platforms: fm.platforms,
    actions: fm.actions,
    priority: fm.priority,
    builtin: false,
    enabled: true, // 导入即生效,与改造前一致
  });
}

// 导出成 .md:能被 Obsidian 正常渲染,也能被本函数原样读回来
export function serializeSkill(s) {
  const fm = [`name: ${JSON.stringify(s.name)}`];
  if (s.description) fm.push(`description: ${JSON.stringify(s.description)}`);
  if (s.platforms?.length) fm.push(`platforms: [${s.platforms.join(", ")}]`);
  if (s.actions?.length) fm.push(`actions: [${s.actions.join(", ")}]`);
  if (s.priority !== 50) fm.push(`priority: ${s.priority}`);
  return `---\n${fm.join("\n")}\n---\n\n${s.content}\n`;
}

// 作用域的人话标签,写作页左栏与技能页共用一份实现
export function scopeLabels(s) {
  const out = [];
  if (s.platforms?.length) {
    out.push(s.platforms.map(id => PLATFORMS.find(p => p.id === id)?.name || id).join("/"));
  }
  if (s.actions?.length) {
    const named = ACTION_CHOICES
      .filter(c => (ACTION_GROUPS[c.id] || [c.id]).every(op => s.actions.includes(op)))
      .map(c => c.name);
    out.push(named.length ? named.join("/") : `${s.actions.length} 个操作`);
  }
  return out;
}

// ---- 作用域筛选与预算裁剪 ----

export function matchScope(s, op, platformId) {
  if (s.platforms && platformId && !s.platforms.includes(platformId)) return false;
  if (s.actions) return s.actions.includes(op);
  return !OPT_IN_OPS.includes(op); // 未声明 actions → 除 check/manual 外全部生效
}

// 作用域具体度:声明了作用域的技能是"专为这个场景写的",冲突时应压过通用技能。
// 等价于 CSS 特异性,用户不用学新概念
const specificity = (s) => (s.platforms ? 2 : 0) + (s.actions ? 1 : 0);

/**
 * 算出当前上下文该注入哪些技能。纯函数,可直接用 node 验证。
 * @returns {{used, dropped, chars}} dropped 是命中作用域但超预算被裁掉的,UI 要报给用户
 */
export function selectSkills(skills, { op = "draft", platformId } = {}) {
  const hit = (skills || []).filter(s => s.enabled && matchScope(s, op, platformId));
  const order = new Map(hit.map((s, i) => [s.id, i]));
  hit.sort((a, b) =>
    (b.priority - a.priority) ||
    (specificity(b) - specificity(a)) ||
    ((a.builtin ? 1 : 0) - (b.builtin ? 1 : 0)) || // 用户自建优先于内置
    (order.get(a.id) - order.get(b.id)));

  const used = [], dropped = [];
  let chars = 0;
  for (const s of hit) {
    // 整条要么全进要么全不进:半条规范可能刚好砍掉"反例"那一段,比不注入更有害
    if (used.length >= SKILL_MAX || chars + s.content.length > SKILL_BUDGET) { dropped.push(s); continue; }
    used.push(s);
    chars += s.content.length;
  }
  // 极端情形:优先级最高那条自己就超预算 —— 宁可截断也要让它生效,否则用户会以为技能坏了
  if (used.length === 0 && hit.length > 0) {
    used.push({ ...hit[0], content: hit[0].content.slice(0, SKILL_BUDGET) + "\n…(本条技能过长,已截断)" });
    dropped.shift();
    chars = SKILL_BUDGET;
  }
  return { used, dropped, chars };
}

// 5 条以上技能同时生效时冲突是必然的,所以要给模型一条仲裁规则
export const renderSkillsBlock = (used) => !used?.length ? "" :
  `\n\n以下是本次写作必须严格遵循的技能规范,共 ${used.length} 条,按优先级排列,` +
  `规范之间若有冲突以靠前的为准:\n\n` +
  used.map((s, i) => `【技能 ${i + 1}/${used.length}:${s.name}】\n${s.content}`).join("\n\n");

// ---- 点名调用(对应 Cursor/Claude 的 Manual 档) ----
// 与 presets.js 的 customAction 同一范式:runAction 只读 action 的 id/op/mode/prompt,
// 传自造对象即可。op = manual 会让自动技能块为空 —— 点名就只用这一条,不再叠别的
export const skillAction = (skill) => ({
  id: `skill:${skill.id}`,
  op: "manual",
  name: skill.name,
  mode: "replace",
  prompt: `请严格按下面这份写作技能规范改写这段内容:\n\n【${skill.name}】\n${skill.content}\n\n` +
    `只输出改写后的内容本身,不要解释、不要加引号。`,
});

// ---- 持久化的合并 ----

// 内置技能只存"用户对它做过什么"的偏差,不存全量。
// 这样我以后改了 BUILTIN_SKILLS 的内容,没碰过的用户自动拿到新版;
// 改过正文的用户保留自己的版本;删过的不复活。
export function mergeBuiltins(stored) {
  const ov = stored?.builtin || {};
  return BUILTIN_SKILLS.map(b => normalizeSkill({ ...b, enabled: b.defaultEnabled })).flatMap(b => {
    const o = ov[b.id];
    if (!o) return [b];
    if (o.deleted) return [];
    const edited = typeof o.content === "string" && o.content.trim();
    return [{
      ...b,
      enabled: typeof o.enabled === "boolean" ? o.enabled : b.enabled,
      ...(edited ? {
        content: o.content.slice(0, SKILL_ITEM_MAX),
        name: (o.name || b.name).slice(0, NAME_MAX),
        edited: true,
      } : {}),
    }];
  });
}

// 拆成 {custom, builtin} 落盘。内置只留偏差,体积从几十 KB 压到不到 1KB
export function packSkills(skills) {
  const builtin = {};
  const custom = [];
  for (const s of skills) {
    if (!s.builtin) { custom.push(stripRuntime(s)); continue; }
    const def = BUILTIN_SKILLS.find(b => b.id === s.id);
    if (!def) continue;
    const o = {};
    if (s.enabled !== !!def.defaultEnabled) o.enabled = s.enabled;
    if (s.edited) { o.content = s.content; o.name = s.name; }
    if (Object.keys(o).length) builtin[s.id] = o;
  }
  // 被删掉的内置立墓碑,否则下次启动它们会集体复活
  for (const b of BUILTIN_SKILLS) {
    if (!skills.some(s => s.id === b.id)) builtin[b.id] = { deleted: true };
  }
  return { v: 1, custom, builtin };
}

const stripRuntime = ({ id, name, description, content, platforms, actions, priority, enabled }) =>
  ({ id, name, description, content, platforms, actions, priority, enabled, builtin: false });

// 从落盘数据还原完整技能列表;任何一条坏数据只跳过它自己
export function unpackSkills(stored) {
  const custom = (Array.isArray(stored?.custom) ? stored.custom : [])
    .map(normalizeSkill).filter(Boolean).slice(0, SKILL_COUNT_MAX);
  return [...mergeBuiltins(stored), ...custom];
}

// 有没有被删掉的内置技能(UI 据此决定要不要显示「恢复被删除的内置技能」)
export const hasDeletedBuiltins = (skills) =>
  BUILTIN_SKILLS.some(b => !skills.some(s => s.id === b.id));
