// ============ SQLite 后端(仅桌面端) ============
// 设置与技能库存在 %APPDATA%/com.luobi.app/luobi.db。
// **文章不在这里**——文章的事实来源是 .md 文件(自选文件夹)或内部存储,与本模块无关。
//
// 对外暴露的四个函数与 storage.js 里同名函数**契约完全一致**(进出都是同样形状的
// JS 对象),所以 store.jsx 一行不用改,skills.js 的 packSkills/unpackSkills 也照旧可用。
// 换句话说:换的是落盘方式,不是数据模型。
//
// 表结构见 src-tauri/src/lib.rs 的 migrations()。settings 按行存(一个键一行)
// 是这次换库唯一的实质收益:改一个字段只写一行,不必把整包设置重新序列化。

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
  if (!rows?.length) return null; // 没有任何行 = 还没迁移过,调用方据此触发一次性导入
  const out = {};
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.value); } catch { /* 单个坏值跳过,不毁整份设置 */ }
  }
  return out;
}

export async function saveSettingsDb(obj) {
  const db = await getDb();
  // 逐键 upsert。settings 只有十几个键,一次全写也就十几条语句;
  // 真正省掉的是"整包重新序列化"——技能几十 KB 已经不在这张表里了
  for (const [k, v] of Object.entries(obj || {})) {
    await db.execute(
      "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [k, JSON.stringify(v ?? null)],
    );
  }
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
  // 全量替换而不是 diff:技能总量在几十条量级,一次 DELETE + 批量 INSERT
  // 比维护一套增量逻辑简单得多,也不会有"漏写一条"的风险
  await db.execute("DELETE FROM skills");
  let sort = 0;
  for (const s of obj?.custom || []) {
    await db.execute(
      `INSERT INTO skills (id, builtin, deleted, enabled, name, description, content, platforms, actions, priority, sort)
       VALUES ($1, 0, 0, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [s.id, s.enabled ? 1 : 0, s.name, s.description || "", s.content,
        s.platforms ? JSON.stringify(s.platforms) : null,
        s.actions ? JSON.stringify(s.actions) : null,
        s.priority ?? 50, sort++],
    );
  }
  for (const [id, o] of Object.entries(obj?.builtin || {})) {
    await db.execute(
      `INSERT INTO skills (id, builtin, deleted, enabled, name, content, sort)
       VALUES ($1, 1, $2, $3, $4, $5, $6)`,
      [id, o.deleted ? 1 : 0,
        typeof o.enabled === "boolean" ? (o.enabled ? 1 : 0) : null,
        o.name ?? null, o.content ?? null, sort++],
    );
  }
}

// ---- 一次性迁移:把旧的 tauri-plugin-store JSON 搬进来 ----
// **迁移永不破坏性**:settings.json 一个字都不删,留着当安全网。
// 万一 SQLite 这条路出问题,把 db 文件删掉就退回原状
export async function migrateFromStore(oldSettings, oldSkills) {
  if (oldSettings && Object.keys(oldSettings).length) await saveSettingsDb(oldSettings);
  if (oldSkills) await saveSkillsDb(oldSkills);
}
