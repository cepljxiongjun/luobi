import { isTauri } from "./api";
import {
  dbAvailable, loadSettingsDb, saveSettingsDb, loadSkillsDb, saveSkillsDb, migrateFromStore,
} from "./db";

// ============ 持久化:按运行环境选后端 ============
// 设置与技能:
//   - Tauri 桌面端 → SQLite(%APPDATA%/com.luobi.app/luobi.db),设置按行存
//   - 浏览器 → localStorage(拖 SQLite 的 wasm 进来要几 MB,为几十 KB 数据不值)
// 文章:不走这里的 SQLite,见 articlesFs.js —— 事实来源是 .md 文件或下面的内部存储兜底
//
// tauri-plugin-store(settings.json)保留:一是文章的内部存储兜底还用它,
// 二是它是 SQLite 的降级出口和迁移来源,里面的旧数据一个字都不删
const LS_KEY = "luobi-settings-v1";
const STORE_FILE = "settings.json";
const STORE_KEY = "settings";
const ARTICLES_LS_KEY = "luobi-articles-v1";
const ARTICLES_KEY = "articles";
const SKILLS_LS_KEY = "luobi-skills-v1";
const SKILLS_KEY = "skills";

let tauriStorePromise = null;
function getTauriStore() {
  if (!tauriStorePromise) {
    tauriStorePromise = import("@tauri-apps/plugin-store").then(({ load }) =>
      load(STORE_FILE, { autoSave: false })
    );
  }
  return tauriStorePromise;
}

// 旧后端(tauri-plugin-store / localStorage)的原始读写,迁移与降级都靠它
async function readLegacy(storeKey, lsKey, fallback) {
  try {
    if (isTauri) {
      const store = await getTauriStore();
      return (await store.get(storeKey)) ?? fallback;
    }
    const raw = localStorage.getItem(lsKey);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

async function writeLegacy(storeKey, lsKey, value) {
  try {
    if (isTauri) {
      const store = await getTauriStore();
      await store.set(storeKey, value);
      await store.save();
      return;
    }
    localStorage.setItem(lsKey, JSON.stringify(value));
  } catch { /* 存储不可用(隐私模式等)时静默,应用照常可用 */ }
}

// 首次进 SQLite 时把旧 JSON 里的东西搬过来。只跑一次,由"表是空的"触发。
// 记的是 promise 不是布尔:设置与技能两条水合链会并行调它,记布尔的话第二个调用方
// 会在迁移还没跑完时就返回,然后读到一张空表
let migration = null;
function migrateOnce() {
  if (!migration) {
    migration = (async () => {
      const [oldSettings, oldSkills] = await Promise.all([
        readLegacy(STORE_KEY, LS_KEY, null),
        readLegacy(SKILLS_KEY, SKILLS_LS_KEY, null),
      ]);
      if (oldSettings || oldSkills) await migrateFromStore(oldSettings, oldSkills);
    })().catch(() => { /* 迁移失败不阻塞启动,读出来是空的,旧 JSON 还在 */ });
  }
  return migration;
}

// ---- 设置 ----

export async function loadSettings() {
  try {
    if (await dbAvailable()) {
      const fromDb = await loadSettingsDb();
      if (fromDb) return fromDb;
      await migrateOnce();               // 表是空的 → 可能是老用户,搬一次
      return (await loadSettingsDb()) ?? null;
    }
  } catch { /* SQLite 出问题就退回旧后端,下面接着走 */ }
  return readLegacy(STORE_KEY, LS_KEY, null);
}

export async function saveSettings(obj) {
  try {
    if (await dbAvailable()) { await saveSettingsDb(obj); return; }
  } catch { /* 落到旧后端 */ }
  await writeLegacy(STORE_KEY, LS_KEY, obj);
}

// ---- 技能 ----

export async function loadSkills() {
  try {
    if (await dbAvailable()) {
      const fromDb = await loadSkillsDb();
      if (fromDb) return fromDb;
      await migrateOnce();
      return (await loadSkillsDb()) ?? null;
    }
  } catch { /* 落到旧后端 */ }
  return readLegacy(SKILLS_KEY, SKILLS_LS_KEY, null);
}

export async function saveSkills(obj) {
  try {
    if (await dbAvailable()) { await saveSkillsDb(obj); return; }
  } catch { /* 落到旧后端 */ }
  await writeLegacy(SKILLS_KEY, SKILLS_LS_KEY, obj);
}

// ---- 文章:内部存储兜底(自选了文件夹时走 articlesFs.js,不经过这里) ----
// 刻意不进 SQLite:文章的事实来源应该是能被 Obsidian 打开的 .md 文件,
// 塞进数据库等于把刚打开的盒子又焊死

export async function loadArticles() {
  const list = await readLegacy(ARTICLES_KEY, ARTICLES_LS_KEY, []);
  return Array.isArray(list) ? list : [];
}

export async function saveArticles(list) {
  await writeLegacy(ARTICLES_KEY, ARTICLES_LS_KEY, list);
}
