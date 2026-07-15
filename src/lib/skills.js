// ============ 写作技能(Skills) ============
// 技能 = 一份写作规范/方法论文本,启用后会注入到每次生成的提示词中
export const BUILTIN_SKILLS = [
  {
    id: "sk-hook", name: "黄金开头三板斧", builtin: true, enabled: false,
    content: "开头必须在前两句抓住读者,任选其一:①反常识观点(先说一个和大众认知相反的结论)②具体场景(用一个有画面感的瞬间把读者拉进来)③直击痛点提问(问出读者心里正在想的那个问题)。禁止用「随着…的发展」「在当今社会」这类空泛开头。",
  },
  {
    id: "sk-title", name: "爆款标题公式", builtin: true, enabled: false,
    content: "标题优先使用以下结构:数字盘点式(如「5个方法」)、对比反差式(「月薪5千 vs 月薪5万」)、悬念留白式(结尾留半句)、身份代入式(点名目标人群)。标题控制在12-24字,至少包含一个具体数字或具体人群词。",
  },
];

// 解析导入的技能文件:支持带 YAML frontmatter 的 SKILL.md(name/description 字段),也支持纯文本
export function parseSkillFile(filename, text) {
  let name = filename.replace(/\.(md|txt|markdown)$/i, "");
  let body = text.trim();
  const fm = body.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (fm) {
    const nameMatch = fm[1].match(/^name:\s*(.+)$/m);
    if (nameMatch) name = nameMatch[1].trim().replace(/^["']|["']$/g, "");
    body = body.slice(fm[0].length).trim();
  }
  return { id: `sk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, content: body, builtin: false, enabled: true };
}
