// ============ 技能文件夹(仅桌面端):放入即生效 ============
//
// 用户指一个文件夹,往里丢 .md 就是一条技能,在 VS Code / Obsidian 里改完保存就更新。
//
// **文件夹技能在应用里只读**:事实来源是文件,应用只负责开关、展示、在文件夹中显示。
// 这正是文章文件夹不做监听、这里却敢做的原因——文章会在应用里被编辑,外部改动和
// 编辑中的内容没法合并;技能不在应用里写,就不存在合并问题。
//
// 认两种布局:
//   根目录 *.md(README.md 除外)              —— 手写的单文件技能
//   <名字>/SKILL.md(只看一层子目录)           —— Claude Agent Skills 标准布局,可直接 clone 生态仓库
// 子目录里 SKILL.md 以外的文件(scripts / references)一概不读:落笔是单次 prompt,用不上。

import { isTauri } from "./api";
import { parseSkillFile, parseFrontmatter, SKILL_ITEM_MAX } from "./skills";

// 动态 import:静态 import 会把桌面端代码打进浏览器主 chunk(与 articlesFs.js 同一写法)
const fsMod = () => import("@tauri-apps/plugin-fs");
const dialogMod = () => import("@tauri-apps/plugin-dialog");
const openerMod = () => import("@tauri-apps/plugin-opener");

const sepOf = (dir) => (dir.includes("\\") ? "\\" : "/");
const join = (dir, ...parts) => [dir.replace(/[\\/]+$/, ""), ...parts].join(sepOf(dir));

export const FOLDER_SKILL_MAX = 50; // 与自建技能同一上限
export const FOLDER_ID_PREFIX = "fs:";
export const isFolderSkill = (s) => typeof s?.id === "string" && s.id.startsWith(FOLDER_ID_PREFIX);

const isSkillMd = (name) => /^skill\.md$/i.test(name);
const isReadme = (name) => /^readme\.md$/i.test(name);

function classify(err) {
  const msg = String(err?.message || err || "");
  if (/no such file|not found|cannot find/i.test(msg)) return "技能文件夹不见了(可能是移动硬盘未连接)";
  if (/forbidden|not allowed|permission|denied|access/i.test(msg)) return "没有读取这个文件夹的权限,请重新选择一次";
  return `读取技能文件夹失败:${msg.slice(0, 80) || "未知错误"}`;
}

/** 选技能文件夹。recursive: true —— 要读子目录里的 SKILL.md;Rust 侧启动补授用同样的参数 */
export async function pickSkillsDir() {
  if (!isTauri) return null;
  const { open } = await dialogMod();
  const picked = await open({
    directory: true, recursive: true, multiple: false,
    title: "选择技能文件夹(放进去的 .md 自动成为技能)",
  });
  return typeof picked === "string" ? picked : null;
}

export async function revealSkill(dir, relPath) {
  if (!isTauri || !dir) return;
  const { revealItemInDir } = await openerMod();
  // 不用 openPath 的理由同 articlesFs.revealDir:open_path 走 ACL scope,任选目录必被拦
  try { await revealItemInDir(relPath ? join(dir, ...relPath.split("/")) : dir); } catch { /* 打不开就算了 */ }
}

// 一个文件 → 一条技能。relPath 统一用 "/" 分隔,id 与 off 集合都靠它,跨平台一致
function toSkill(relPath, text) {
  const parts = relPath.split("/");
  const fileName = parts[parts.length - 1];
  // SKILL.md 没写 name 时,回退成目录名而不是 "SKILL"
  const fallbackName = isSkillMd(fileName) && parts.length > 1 ? `${parts[parts.length - 2]}.md` : fileName;
  const s = parseSkillFile(fallbackName, text);
  if (!s) return null;
  return {
    ...s,
    id: FOLDER_ID_PREFIX + relPath,
    path: relPath,
    source: "folder",
    builtin: false,
    // parseSkillFile 内部已按 SKILL_ITEM_MAX 截断正文;这里只标记,让界面说清楚
    truncated: parseFrontmatter(text).body.trim().length > SKILL_ITEM_MAX,
  };
}

/**
 * 扫描技能文件夹。返回 { items: [skill...], error }。
 * 单个坏文件跳过不影响其余;目录整体读不了才返回 error 且 items 为空。
 */
export async function scanSkillsDir(dir) {
  if (!dir || !isTauri) return { items: [], error: "" };
  try {
    const { exists, readDir, readTextFile } = await fsMod();
    if (!(await exists(dir))) return { items: [], error: "技能文件夹不见了(可能是移动硬盘未连接)" };

    const found = []; // 相对路径
    for (const e of await readDir(dir)) {
      if (e.isFile && /\.md$/i.test(e.name) && !isReadme(e.name)) found.push(e.name);
      else if (e.isDirectory && !e.name.startsWith(".")) {
        try {
          const sub = await readDir(join(dir, e.name));
          const skillMd = sub.find(x => x.isFile && isSkillMd(x.name));
          if (skillMd) found.push(`${e.name}/${skillMd.name}`);
        } catch { /* 子目录读不了就当没有 */ }
      }
    }
    found.sort((a, b) => a.localeCompare(b, "zh-CN"));

    const items = [];
    let skipped = 0;
    for (const rel of found) {
      if (items.length >= FOLDER_SKILL_MAX) break;
      try {
        const s = toSkill(rel, await readTextFile(join(dir, ...rel.split("/"))));
        if (s) items.push(s); else skipped++;
      } catch { skipped++; }
    }
    const notes = [];
    if (skipped) notes.push(`${skipped} 个文件没有正文或读不了,已跳过`);
    if (found.length > FOLDER_SKILL_MAX) notes.push(`只载入前 ${FOLDER_SKILL_MAX} 个`);
    return { items, error: "", note: notes.join(";") };
  } catch (err) {
    return { items: [], error: classify(err) };
  }
}

/**
 * 监听技能文件夹,有任何增删改就回调(防抖 300ms)。返回停止监听的函数。
 * 监听起不来(比如老版本没开 watch feature)时返回空函数——调用方还有
 * 窗口聚焦重扫与手动重扫两道兜底,不至于完全失效。
 */
export async function watchSkillsDir(dir, onChange) {
  if (!dir || !isTauri) return () => {};
  try {
    const { watch } = await fsMod();
    const unwatch = await watch(dir, () => onChange(), { recursive: true, delayMs: 300 });
    return typeof unwatch === "function" ? unwatch : () => {};
  } catch {
    return () => {};
  }
}
