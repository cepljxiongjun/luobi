import { isTauri } from "./api";

// ============ 设置持久化:按运行环境选存储后端 ============
// - 浏览器 → localStorage
// - Tauri 桌面端 → tauri-plugin-store(JSON 文件存在系统应用数据目录,
//   Windows 在 %APPDATA%/com.luobi.app/settings.json,清 WebView 缓存不丢)
const LS_KEY = "luobi-settings-v1";
const STORE_FILE = "settings.json";
const STORE_KEY = "settings";
   
let tauriStorePromise = null;
function getTauriStore() {
  if (!tauriStorePromise) {
    tauriStorePromise = import("@tauri-apps/plugin-store").then(({ load }) =>
      load(STORE_FILE, { autoSave: false })
    );
  }
  return tauriStorePromise;
}

export async function loadSettings() {
  try {
    if (isTauri) {
      const store = await getTauriStore();
      return (await store.get(STORE_KEY)) ?? null;
    }
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // 读取失败按首次启动处理,不阻塞应用
  }
}

export async function saveSettings(obj) {
  try {
    if (isTauri) {
      const store = await getTauriStore();
      await store.set(STORE_KEY, obj);
      await store.save();
      return;
    }
    localStorage.setItem(LS_KEY, JSON.stringify(obj));
  } catch { /* 存储不可用(隐私模式等)时静默,应用照常可用 */ }
}

// ============ 文章库持久化(与设置同一存储后端,独立键) ============
const ARTICLES_LS_KEY = "luobi-articles-v1";
const ARTICLES_KEY = "articles";

export async function loadArticles() {
  try {
    if (isTauri) {
      const store = await getTauriStore();
      return (await store.get(ARTICLES_KEY)) ?? [];
    }
    const raw = localStorage.getItem(ARTICLES_LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveArticles(list) {
  try {
    if (isTauri) {
      const store = await getTauriStore();
      await store.set(ARTICLES_KEY, list);
      await store.save();
      return;
    }
    localStorage.setItem(ARTICLES_LS_KEY, JSON.stringify(list));
  } catch { /* 存储不可用时静默 */ }
}
