// ============ 文章库存储后端 ============
// 两种后端,由 dir 是否为空决定:
//   dir === ""  → 应用内部存储(storage.js:浏览器 localStorage / 桌面端 settings.json)
//   dir !== ""  → 用户选定的文件夹,每篇文章一个 .md(仅桌面端)
// 本模块是唯一的分发点,store.jsx 只管调 readAll / syncAll,不关心落在哪。
//
// 一条贯穿始终的原则:**内存里的 articles 永远是工作副本,文件系统只是 sink。
// 任何写失败都不得让文章从内存里消失**,并且要顺手把整份数据写回内部存储兜底。

import { isTauri } from "./api";
import { loadArticles, saveArticles } from "./storage";
import { serializeArticle, parseArticle, fileNameFor } from "./mdfile";

// Tauri 插件一律动态 import:静态 import 会被 Vite 打进主 chunk,
// 浏览器构建就白白带上了桌面端代码(现有 storage.js 也是这个写法)
const fsMod = () => import("@tauri-apps/plugin-fs");
const dialogMod = () => import("@tauri-apps/plugin-dialog");
const openerMod = () => import("@tauri-apps/plugin-opener");

// 路径拼接:Windows 用反斜杠,其余用正斜杠。只需拼一层文件名,不必引 path 插件
const sepOf = (dir) => (dir.includes("\\") ? "\\" : "/");
const join = (dir, name) => dir.replace(/[\\/]+$/, "") + sepOf(dir) + name;

// 所有 fs 操作串成一条链:防抖窗口重叠时不会两轮同步交错写同一个文件。
// then(fn, fn) 是故意的——前一轮失败也要继续跑下一轮,不能让链断掉
let queue = Promise.resolve();
const enqueue = (fn) => (queue = queue.then(fn, fn));

// 已落盘状态 id -> {file, updatedAt},增量 diff 的依据。
// 为什么放在模块里而不是让调用方传进来:一次同步没跑完时下一次就可能被排上队,
// 调用方手里的那份必然是旧的,两轮都会把同一篇当成"新建",于是写出两个重复文件。
// 放在这里,排到队时读的永远是上一轮刚更新过的那份。
let synced = new Map();
export const setSynced = (map) => { synced = map instanceof Map ? map : new Map(); };
// 「打开文件夹」要随便挑一个文件来定位目录
export const firstSyncedFile = () => synced.values().next().value?.file;

const normalize = (list) =>
  Array.isArray(list) ? list.filter(a => a && typeof a.id === "string") : [];

// 把底层错误转成人话。目录不存在是最常见的一种(移动硬盘没插、文件夹被改名)
function classify(err) {
  const msg = String(err?.message || err || "");
  if (msg.includes("__missing__") || /no such file|not found|cannot find/i.test(msg)) {
    return "文件夹不见了(可能是移动硬盘未连接)";
  }
  if (/permission|denied|forbidden|access/i.test(msg)) return "没有该文件夹的写入权限";
  if (/no space|disk full/i.test(msg)) return "磁盘空间不足";
  return `写入失败:${msg.slice(0, 80) || "未知错误"}`;
}

// ---- 选文件夹 / 打开文件夹 ----

export async function pickDir() {
  if (!isTauri) return null;
  const { open } = await dialogMod();
  // directory:true 时 dialog 插件会自动把选中目录加进 fs 的运行时 scope
  // (见 plugins/dialog/src/commands.rs 的 s.allow_directory)。
  // recursive 保持 false,与 Rust 侧启动补授的参数一致,两条路授出同样的 glob
  const picked = await open({
    directory: true, recursive: false, multiple: false,
    title: "选择文章存放的文件夹",
  });
  return typeof picked === "string" ? picked : null;
}

export async function revealDir(dir, someFile) {
  if (!isTauri || !dir) return;
  const { revealItemInDir } = await openerMod();
  // 为什么不用 openPath:opener 的 open_path 走 ACL scope 校验且没有运行时 scope 可扩展,
  // 用户任选的目录必然被拦;reveal_item_in_dir 的命令签名里根本没有 scope 参数,不受限。
  // 传目录里的某个文件 → 文件管理器会打开该目录并选中它
  try { await revealItemInDir(someFile ? join(dir, someFile) : dir); } catch { /* 打不开就算了 */ }
}

// ---- 读 ----

/**
 * 读出整个文章库。
 * @returns {{articles, map, error}} map 是 id -> {file, updatedAt},供后续增量同步 diff 用
 */
export async function readAll(dir) {
  if (!dir || !isTauri) {
    return { articles: normalize(await loadArticles()), map: new Map(), error: "" };
  }
  try {
    const { exists, readDir, readTextFile, stat } = await fsMod();
    // 目录不存在时 exists 会干净地返回 false(不是抛 scope 错),可以直接当降级信号
    if (!(await exists(dir))) return degraded("文件夹不见了(可能是移动硬盘未连接)");

    const entries = (await readDir(dir)).filter(e => e.isFile && /\.md$/i.test(e.name));
    const articles = [];
    const map = new Map();
    let skipped = 0;

    for (const e of entries) {
      try {
        const path = join(dir, e.name);
        const text = await readTextFile(path);
        let mtime = 0;
        try { mtime = (await stat(path))?.mtime?.getTime?.() || 0; } catch { /* 时间取不到就用 0 */ }
        const a = parseArticle(text, e.name, mtime);
        if (!a || map.has(a.id)) { skipped++; continue; } // 坏文件/重复 id 跳过,不影响其余
        articles.push(a);
        map.set(a.id, { file: e.name, updatedAt: a.updatedAt });
      } catch { skipped++; }
    }
    return { articles, map, error: skipped ? `有 ${skipped} 个文件无法识别,已跳过` : "" };
  } catch (err) {
    return degraded(classify(err));
  }
}

// 降级:文件夹读不了时改用内部存储的副本。配置不动,U 盘插回来就能自愈。
// fatal 标记"这个目录根本读不了",与"读到了但有几个坏文件"区分开——
// 选目录时前者不该把配置落下去,后者可以
async function degraded(reason) {
  return {
    articles: normalize(await loadArticles()),
    map: new Map(),
    error: `${reason},文章已临时存回本机内部存储`,
    fatal: true,
  };
}

// ---- 写(增量) ----

/**
 * 把内存里的 articles 同步到后端。只写变了的那几篇,不是全量重写。
 * @returns {{error}} 已落盘状态记在模块内的 synced 里,只在真正写成功后才更新
 */
export function syncAll(dir, articles) {
  if (!dir || !isTauri) {
    return enqueue(async () => {
      await saveArticles(articles);
      return { error: "" };
    });
  }

  return enqueue(async () => {
    const prevMap = synced;
    const map = new Map(prevMap);
    let error = "";
    try {
      const { exists, writeTextFile, rename, remove } = await fsMod();
      if (!(await exists(dir))) throw new Error("__missing__");

      for (const a of articles) {
        const prev = map.get(a.id);
        // updatedAt 没变就是没改过。saveArticle 保证了它严格单调递增,这个判断才可靠
        if (prev && prev.updatedAt === a.updatedAt) continue;

        let file = prev?.file || await uniqueName(dir, a, map, exists);
        const want = fileNameFor(a);
        if (prev && prev.file !== want) {
          // 标题改了 → 重命名,让文件夹在 Obsidian 里保持可读。
          // 失败(被别的程序占用/只读)不算错误:继续往旧文件名写内容。
          // 内容正确优先于文件名好看
          try { await rename(join(dir, prev.file), join(dir, want)); file = want; } catch { /* 保持旧名 */ }
        }
        await writeTextFile(join(dir, file), serializeArticle(a));
        map.set(a.id, { file, updatedAt: a.updatedAt });
      }

      // 内存里已删掉的,把对应文件也删掉
      for (const [id, meta] of prevMap) {
        if (articles.some(a => a.id === id)) continue;
        try { await remove(join(dir, meta.file)); } catch { /* 已被手动删掉也算达成目的 */ }
        map.delete(id);
      }
    } catch (err) {
      error = `${classify(err)},文章已临时存回本机内部存储`;
      await saveArticles(articles); // 兜底:任何落盘失败都不能让文章消失
    }
    synced = map;
    return { error };
  });
}

// 文件名兜底去重。短 id 已经让重名几乎不可能,这里只防极端情况
async function uniqueName(dir, a, map, exists) {
  const base = fileNameFor(a);
  const taken = new Set([...map.values()].map(v => v.file));
  const tryName = async (n) => !taken.has(n) && !(await exists(join(dir, n)));
  if (await tryName(base)) return base;
  const stem = base.replace(/\.md$/i, "");
  for (let i = 2; i <= 20; i++) {
    const n = `${stem}-${i}.md`;
    if (await tryName(n)) return n;
  }
  return `${a.id}.md`; // id 必然唯一,最后的保险
}

// ---- 首次选定文件夹时的迁移 ----

/**
 * 把内存里的文章复制进新选的文件夹。
 * 迁移永不破坏性:内部存储里的旧数据一个字都不删,留着当安全网。
 * 部分失败也接受——已写进去的是真的在那儿了,没写成的还在内存里,下一轮防抖会重试。
 * @returns {{ok, fail, reason}}
 */
export function migrate(dir, mine) {
  return enqueue(async () => {
    const { exists, writeTextFile } = await fsMod();
    let ok = 0, fail = 0, reason = "";
    for (const a of mine) {
      if (synced.has(a.id)) continue; // 文件夹里已有同 id 的,以文件夹为准
      try {
        const name = await uniqueName(dir, a, synced, exists);
        await writeTextFile(join(dir, name), serializeArticle(a));
        synced.set(a.id, { file: name, updatedAt: a.updatedAt });
        ok++;
      } catch (err) {
        fail++;
        if (!reason) reason = classify(err);
      }
    }
    return { ok, fail, reason };
  });
}
