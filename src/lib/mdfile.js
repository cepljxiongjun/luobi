// ============ 文章 ↔ 单个 .md 文件的互转 ============
// 配了存储文件夹后,每篇文章就是文件夹里的一个 .md:YAML frontmatter 存元数据,下面是正文。
// 为什么手写而不引 yaml 库:frontmatter 只有 7 个固定字段、值一律引号包裹,规则封闭,
// 手写 30 行比拖一个 npm 依赖进来划算。
//
// 解析必须"坏一个文件跳一个"——一个被手改坏的文件绝不能把整个文库读空。

// 字符串值一律双引号 + 转义:标题里出现 : # " 是常态,不加引号就不是合法 YAML,
// Obsidian 的 properties 面板会解析失败
const esc = (s) => `"${String(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
// 时间落盘用 ISO 8601(人能读、Obsidian 能排序),内存里仍是毫秒时间戳
const iso = (ts) => new Date(Number(ts) || Date.now()).toISOString();

export function serializeArticle(a) {
  const fm = [
    `id: ${a.id}`, // id 由我们生成,形如 a-1753660800000-k3f9x,不含特殊字符,不需要引号
    `title: ${esc(a.title)}`,
    `platform: ${esc(a.platformId)}`,
    `tone: ${esc(a.toneId)}`,
    `topic: ${esc(a.topic)}`,
    `createdAt: ${iso(a.createdAt)}`,
    `updatedAt: ${iso(a.updatedAt)}`,
  ].join("\n");
  // 正文不再加 "# 标题":标题已在 frontmatter 里,再写一遍 H1 会在读写往返时重复堆叠。
  // (exportMd 是分享产物,那边保留 H1,两者语义不同)
  return `---\n${fm}\n---\n\n${String(a.content || "").replace(/\r\n/g, "\n")}\n`;
}

/**
 * 解析一个 .md 文件。
 * @param text     文件全文
 * @param fileName 文件名,用于没有 frontmatter 时兜底造 id/title
 * @param mtime    文件修改时间(毫秒),用于时间字段兜底
 * @returns article 或 null(null = 这个文件跳过,调用方计数但不报错)
 */
export function parseArticle(text, fileName, mtime) {
  // 用户在 Windows 记事本编辑过会变 CRLF,先归一化,否则正则和字数都会错
  const src = String(text || "").replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  if (!m) return adoptPlainMd(src, fileName, mtime);

  const fm = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!kv) continue; // 认不出的行直接忽略,不算整个文件失败
    let v = kv[2].trim();
    if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
      v = v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    fm[kv[1]] = v;
  }
  // 尾部换行必须清掉:serializeArticle 会在正文末尾补一个 \n(文本文件的惯例),
  // 不清的话每存一次就多攒一个空行,存二十次正文末尾就多出二十行
  const body = src.slice(m[0].length).replace(/^\n+/, "").replace(/\n+$/, "");
  const ts = (s) => { const n = Date.parse(s); return Number.isFinite(n) ? n : (mtime || 0); };

  const id = /^[\w.-]{1,64}$/.test(fm.id || "") ? fm.id : idFromFileName(fileName);
  if (!id) return null; // 连 id 都造不出来才放弃这个文件

  return {
    id,
    // 区分"没有 title 字段"和"标题就是空的":后者要原样保留,
    // 否则用户的无标题文章会在一次往返后被文件名顶替掉
    title: "title" in fm ? fm.title : stripExt(fileName),
    content: body,
    topic: fm.topic || "",
    platformId: fm.platform || "",
    toneId: fm.tone || "",
    createdAt: ts(fm.createdAt),
    updatedAt: ts(fm.updatedAt),
  };
}

// 没有 frontmatter 的普通 .md:标题取首个 H1,否则取文件名。
// 为什么收编而不是跳过:文件夹是"真正的存储后端",用户往里丢的东西就该出现在文库里,
// 否则"我明明放进去了却看不到"是更糟的体验。第一次在应用里保存时会自动补上 frontmatter。
function adoptPlainMd(src, fileName, mtime) {
  const id = idFromFileName(fileName);
  if (!id) return null;
  const h1 = /^#\s+(.+)$/m.exec(src);
  const title = (h1 ? h1[1] : stripExt(fileName)).trim();
  // 标题来自 H1 时把那一行从正文里摘掉,免得保存回来后正文里多一行重复标题
  const content = (h1 ? src.replace(h1[0], "") : src).replace(/^\n+/, "").replace(/\n+$/, "");
  const t = mtime || 0;
  return { id, title, content, topic: "", platformId: "", toneId: "", createdAt: t, updatedAt: t };
}

const stripExt = (f) => String(f || "").replace(/\.md$/i, "");

// 由文件名派生 id:同一个文件跨重启要拿到同一个 id,否则每次扫描都会当成新文章
function idFromFileName(fileName) {
  const base = stripExt(fileName).replace(/[^\w一-龥-]/g, "_").slice(0, 48);
  return base ? `a-file-${base}` : "";
}

// ============ 文件名规则 ============
// Windows 保留设备名:即使带扩展名也不能用,必须加前缀避开
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// 取 id 末段的随机串。把它拼进文件名是整套方案的地基:
// 重名天然不撞、从 id 能反推文件名(不需要额外的索引文件)、用户看到的仍是标题打头
export const shortIdOf = (id) => (String(id).split("-").pop() || "x").slice(0, 8);

export function fileNameFor(a) {
  let t = String(a.title || "").trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_") // Windows 非法字符 + 控制字符
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "");           // Windows 不允许文件名首尾是空格或点
  t = [...t].slice(0, 40).join("");             // 按码点截,不然会把 emoji 的代理对劈开
  if (WIN_RESERVED.test(t)) t = `_${t}`;
  if (!t) t = "未命名";
  return `${t}-${shortIdOf(a.id)}.md`;
}
