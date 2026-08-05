import { isTauri } from "./api";
import {
  dbAvailable, loadSettingsDb, saveSettingsDb, loadSkillsDb, saveSkillsDb,
  loadArticlesDb, saveArticlesDb, loadDraftDb, saveDraftDb, migrateFromStore,
} from "./db";

// ============ 持久化:按运行环境选后端 ============
//   - Tauri 桌面端 → SQLite(%APPDATA%/com.luobi.app/luobi.db)
//   - 浏览器 → localStorage(拖 SQLite 的 wasm 进来要几 MB,为几十 KB 数据不值)
//
// 选了自选文件夹时,文章走 articlesFs.js 直接读写 .md,根本不到这里。
//
// tauri-plugin-store(settings.json)已退出写入路径,只剩两个职责:
// SQLite 探不通时的降级出口、以及一次性迁移的来源。旧数据一个字都不删,留作安全网;
// 等确认没有用户还停在旧版本,这个依赖就可以整个摘掉
const LS_KEY = "luobi-settings-v1";
const STORE_FILE = "settings.json";
const STORE_KEY = "settings";
const ARTICLES_LS_KEY = "luobi-articles-v1";
const ARTICLES_KEY = "articles";
const SKILLS_LS_KEY = "luobi-skills-v1";
const SKILLS_KEY = "skills";
const DRAFT_LS_KEY = "luobi-draft-v1";
const DRAFT_KEY = "draft";

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
      const [oldSettings, oldSkills, oldArticles] = await Promise.all([
        readLegacy(STORE_KEY, LS_KEY, null),
        readLegacy(SKILLS_KEY, SKILLS_LS_KEY, null),
        readLegacy(ARTICLES_KEY, ARTICLES_LS_KEY, null),
      ]);
      if (oldSettings || oldSkills || oldArticles) {
        await migrateFromStore(oldSettings, oldSkills, oldArticles);
      }
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

// ---- 草稿:未保存的工作状态(正文/标题候选/大纲/联网资料/图文卡片) ----
// 没有历史数据,所以不走 migrateOnce;SQLite 探不通就退回旧后端,与其它键同一姿势

export async function loadDraft() {
  try {
    if (await dbAvailable()) return await loadDraftDb();
  } catch { /* 落到旧后端 */ }
  return readLegacy(DRAFT_KEY, DRAFT_LS_KEY, null);
}

export async function saveDraft(obj) {
  try {
    if (await dbAvailable()) { await saveDraftDb(obj); return; }
  } catch { /* 落到旧后端 */ }
  await writeLegacy(DRAFT_KEY, DRAFT_LS_KEY, obj);
}

// ---- 文章:内部存储兜底(自选了文件夹时走 articlesFs.js,根本不经过这里) ----
// 选了文件夹后文章就只是那一堆 .md,事实来源永远是能被 Obsidian 打开的文件。
// 这里进 SQLite 只是为了让 tauri-plugin-store 退出写入路径,不是把文章"收进库"

export async function loadArticles() {
  try {
    if (await dbAvailable()) {
      const rows = await loadArticlesDb();
      if (rows.length) return rows;
      await migrateOnce();
      return await loadArticlesDb();
    }
  } catch { /* 落到旧后端 */ }
  const list = await readLegacy(ARTICLES_KEY, ARTICLES_LS_KEY, []);
  return Array.isArray(list) ? list : [];
}

export async function saveArticles(list) {
  try {
    if (await dbAvailable()) { await saveArticlesDb(list); return; }
  } catch { /* 落到旧后端 */ }
  await writeLegacy(ARTICLES_KEY, ARTICLES_LS_KEY, list);
}
