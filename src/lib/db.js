// ============ SQLite 后端(仅桌面端) ============
// %APPDATA%/com.luobi.app/luobi.db,三张表:settings / skills / articles。
// 表结构见 src-tauri/src/lib.rs 的 migrations()。
//
// **articles 表只是"没选自选文件夹时"的兜底**。选了文件夹,文章就只是那一堆 .md,
// 这张表根本不会被写 —— 文章的事实来源永远应该是能被 Obsidian 打开的文件。
// 把它也搬进来的唯一目的是让 tauri-plugin-store 彻底退出写入路径:
// 一个应用里活着两个存储引擎是纯粹的理解成本。
//
// **刻意不建 FTS5 索引**:实测 800 篇 / 1MB 中文语料,trigram 索引与普通全扫都是
// 1-2ms(5 字查询下 FTS5 反而更慢,因为它在 SCAN 而不是 seek);而文章本来就全量
// 在内存里,JS 过滤零 I/O 且浏览器端同样生效。等语料真大到需要索引再加不迟。
//
// 对外函数与 storage.js 里同名函数**契约完全一致**,所以 store.jsx 一行不用改,
// skills.js 的 packSkills/unpackSkills 也照旧可用。

import { isTauri } from "./api";

const DB_URL = "sqlite:luobi.db";

let dbPromise = null;
function getDb() {
  if (!dbPromise) {
    // 动态 import:静态 import 会把桌面端代码打进浏览器主 chunk
    dbPromise = import("@tauri-apps/plugin-sql").then(m => m.default.load(DB_URL));
  }
  return dbPromise;
}

// SQLite 可用性只探一次。探不通就整体退回 tauri-plugin-store,不让应用打不开
let availability = null;
export function dbAvailable() {
  if (!isTauri) return Promise.resolve(false);
  if (!availability) {
    availability = getDb()
      .then(db => db.select("SELECT 1 AS ok").then(() => true))
      .catch(() => { dbPromise = null; return false; });
  }
  return availability;
}

// ---- 设置:一个键一行,值是 JSON ----

export async function loadSettingsDb() {
  const db = await getDb();
  const rows = await db.select("SELECT key, value FROM settings");
  if (!rows?.length) {
    // 空表 ⇒ 下一次保存必须全写。lastWritten 是模块级的,不清的话
    // (首次迁移、或库被外部删掉重建)diff 会认为"什么都没变"从而一行都不写
    lastWritten = null;
    return null; // 调用方据此触发一次性导入
  }
  const out = {};
  const seen = {};
  for (const r of rows) {
    seen[r.key] = r.value;
    try { out[r.key] = JSON.parse(r.value); } catch { /* 单个坏值跳过,不毁整份设置 */ }
  }
  lastWritten = seen; // 与磁盘对齐,水合后第一次保存才不会退化成全量重写
  return out;
}

// 上次落盘的每键序列化值。store 传下来的永远是整包快照,不比一下就不知道谁变了 ——
// 少了这一层,"按行存"就只是个说法:每次保存照样写十几行,比原来写一个 JSON 文件还费
let lastWritten = null;

export async function saveSettingsDb(obj) {
  const db = await getDb();
  const next = {};
  for (const [k, v] of Object.entries(obj || {})) next[k] = JSON.stringify(v ?? null);

  // 首次落盘(lastWritten 为空)全写;之后只写值真的变了的那几个键
  const changed = Object.entries(next).filter(([k, v]) => !lastWritten || lastWritten[k] !== v);
  for (const [k, v] of changed) {
    await db.execute(
      "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [k, v],
    );
  }
  // 快照里已经没有的键要清掉,否则它会一直躺在表里被读回来
  if (lastWritten) {
    for (const k of Object.keys(lastWritten)) {
      if (!(k in next)) await db.execute("DELETE FROM settings WHERE key = $1", [k]);
    }
  }
  lastWritten = next;
  return changed.length; // 回归用例据此断言"没改就不写"
}

// ---- 技能:自建全量入库,内置只存偏差 ----
// 形状与 storage.js 那版一致:{ v, custom: [...], builtin: { id: {enabled?, name?, content?, deleted?} } }

const toArr = (s) => { try { const a = JSON.parse(s); return Array.isArray(a) ? a : null; } catch { return null; } };

export async function loadSkillsDb() {
  const db = await getDb();
  const rows = await db.select("SELECT * FROM skills ORDER BY sort ASC");
  if (!rows?.length) return null; // 同上:空表 = 还没迁移过
  const custom = [];
  const builtin = {};
  for (const r of rows) {
    if (r.builtin) {
      const o = {};
      if (r.deleted) o.deleted = true;
      if (r.enabled !== null && r.enabled !== undefined) o.enabled = !!r.enabled;
      if (r.content) { o.content = r.content; o.name = r.name || undefined; }
      builtin[r.id] = o;
    } else {
      custom.push({
        id: r.id, name: r.name || "", description: r.description || "", content: r.content || "",
        platforms: toArr(r.platforms), actions: toArr(r.actions),
        priority: r.priority ?? 50, enabled: !!r.enabled, builtin: false,
      });
    }
  }
  return { v: 1, custom, builtin };
}

export async function saveSkillsDb(obj) {
  const db = await getDb();
  // **先 upsert 再删多余行,绝不先 DELETE 全表**:tauri-plugin-sql 的每次 execute
  // 可能拿到连接池里不同的连接,BEGIN/COMMIT 跨不了语句,所以拿不到真事务。
  // 先清空的话,中途任何一步失败(磁盘满、进程被杀)技能就全没了。
  // 换成 upsert + prune 之后,最坏情况只是多留几行陈旧数据,表永远不为空。
  const alive = [];
  let sort = 0;
  for (const s of obj?.custom || []) {
    await db.execute(
      `INSERT INTO skills (id, builtin, deleted, enabled, name, description, content, platforms, actions, priority, sort)
       VALUES ($1, 0, 0, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT(id) DO UPDATE SET
         builtin=0, deleted=0, enabled=excluded.enabled, name=excluded.name,
         description=excluded.description, content=excluded.content,
         platforms=excluded.platforms, actions=excluded.actions,
         priority=excluded.priority, sort=excluded.sort`,
      [s.id, s.enabled ? 1 : 0, s.name, s.description || "", s.content,
        s.platforms ? JSON.stringify(s.platforms) : null,
        s.actions ? JSON.stringify(s.actions) : null,
        s.priority ?? 50, sort++],
    );
    alive.push(s.id);
  }
  for (const [id, o] of Object.entries(obj?.builtin || {})) {
    await db.execute(
      `INSERT INTO skills (id, builtin, deleted, enabled, name, content, sort)
       VALUES ($1, 1, $2, $3, $4, $5, $6)
       ON CONFLICT(id) DO UPDATE SET
         builtin=1, deleted=excluded.deleted, enabled=excluded.enabled,
         name=excluded.name, content=excluded.content, sort=excluded.sort`,
      [id, o.deleted ? 1 : 0,
        typeof o.enabled === "boolean" ? (o.enabled ? 1 : 0) : null,
        o.name ?? null, o.content ?? null, sort++],
    );
    alive.push(id);
  }
  // 清掉这轮不该存在的行。列表为空时用一个不可能命中的占位,避免拼出 "NOT IN ()"
  const ph = alive.length ? alive.map((_, i) => `$${i + 1}`).join(",") : "''";
  await db.execute(`DELETE FROM skills WHERE id NOT IN (${ph})`, alive);
}

// ---- 文章:没选自选文件夹时的兜底 ----

export async function loadArticlesDb() {
  const db = await getDb();
  const rows = await db.select("SELECT * FROM articles ORDER BY updated_at DESC");
  return rows.map(r => ({
    id: r.id, title: r.title || "", content: r.content || "", topic: r.topic || "",
    platformId: r.platform_id || "", toneId: r.tone_id || "",
    createdAt: r.created_at || 0, updatedAt: r.updated_at || 0,
  }));
}

export async function saveArticlesDb(list) {
  const db = await getDb();
  // 同技能表:先 upsert 再 prune,绝不先清空 —— 文章是用户最不能丢的东西
  const alive = [];
  for (const a of list || []) {
    await db.execute(
      `INSERT INTO articles (id, title, content, topic, platform_id, tone_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT(id) DO UPDATE SET
         title=excluded.title, content=excluded.content, topic=excluded.topic,
         platform_id=excluded.platform_id, tone_id=excluded.tone_id, updated_at=excluded.updated_at`,
      [a.id, a.title || "", a.content || "", a.topic || "",
        a.platformId || "", a.toneId || "", a.createdAt || 0, a.updatedAt || 0],
    );
    alive.push(a.id);
  }
  const ph = alive.length ? alive.map((_, i) => `$${i + 1}`).join(",") : "''";
  await db.execute(`DELETE FROM articles WHERE id NOT IN (${ph})`, alive);
}

// ---- 一次性迁移:把旧的 tauri-plugin-store JSON 搬进来 ----
// **迁移永不破坏性**:settings.json 一个字都不删,留着当安全网。
// 万一 SQLite 这条路出问题,把 db 文件删掉就退回原状
export async function migrateFromStore(oldSettings, oldSkills, oldArticles) {
  if (oldSettings && Object.keys(oldSettings).length) await saveSettingsDb(oldSettings);
  if (oldSkills) await saveSkillsDb(oldSkills);
  if (oldArticles?.length) await saveArticlesDb(oldArticles);
}
