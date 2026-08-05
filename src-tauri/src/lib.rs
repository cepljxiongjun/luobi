use tauri::Manager;
use tauri_plugin_fs::FsExt;
use tauri_plugin_sql::{Migration, MigrationKind};

// 数据库文件名。tauri-plugin-sql 会把它解析到 app_config_dir 下
// (见 plugins/sql/src/wrapper.rs 的 path_mapper),Windows 上即
// %APPDATA%/com.luobi.app/luobi.db
const DB_URL: &str = "sqlite:luobi.db";

// 建表。settings 按行存(一个键一行)而不是整包 JSON —— 这样改一个字段
// 只写一行,不必把整包设置重新序列化一遍。
// skills 存的是"用户偏差":自建技能全量入库,内置技能只在被改过/关过/删过时留一行。
fn migrations() -> Vec<Migration> {
  vec![Migration {
    version: 1,
    description: "create settings and skills tables",
    sql: "
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS skills (
        id          TEXT PRIMARY KEY,
        builtin     INTEGER NOT NULL DEFAULT 0,
        deleted     INTEGER NOT NULL DEFAULT 0,
        enabled     INTEGER,
        name        TEXT,
        description TEXT,
        content     TEXT,
        platforms   TEXT,
        actions     TEXT,
        priority    INTEGER,
        sort        INTEGER NOT NULL DEFAULT 0
      );
    ",
    kind: MigrationKind::Up,
  },
  // 文章的"内部存储兜底"(没选自选文件夹时用)也搬进来,好把 tauri-plugin-store
  // 从写入路径上彻底摘掉 —— 一个应用里活着两个存储引擎,是纯粹的理解成本。
  // 注意:选了文件夹时文章仍然只是 .md 文件,这张表根本不会被写。
  // 刻意不建 FTS5 索引:实测 800 篇 / 1MB 中文语料下,trigram 索引与普通全扫都是
  // 1-2ms(5 字查询下 FTS5 反而更慢),而文章本来就全量在内存里,JS 过滤零 I/O
  // 且浏览器端同样生效。等语料真的大到需要索引再加,迁移成本很低。
  Migration {
    version: 2,
    description: "create articles table",
    sql: "
      CREATE TABLE IF NOT EXISTS articles (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL DEFAULT '',
        content     TEXT NOT NULL DEFAULT '',
        topic       TEXT NOT NULL DEFAULT '',
        platform_id TEXT NOT NULL DEFAULT '',
        tone_id     TEXT NOT NULL DEFAULT '',
        created_at  INTEGER NOT NULL DEFAULT 0,
        updated_at  INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_articles_updated ON articles(updated_at DESC);
    ",
    kind: MigrationKind::Up,
  },
  // 草稿(未保存的工作状态):单行 KV。**必须是独立表,不能塞进 settings**——
  // 前端 loadSettingsDb 会把整张 settings 表读进 diff 快照,而草稿键不在设置
  // 快照里,下一次保存设置时的 prune(「快照里没有的键要清掉」)就会把草稿删掉
  Migration {
    version: 3,
    description: "create drafts table",
    sql: "
      CREATE TABLE IF NOT EXISTS drafts (
        id    TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    ",
    kind: MigrationKind::Up,
  }]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_store::Builder::default().build())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(
      tauri_plugin_sql::Builder::default()
        .add_migrations(DB_URL, migrations())
        .build(),
    )
    .setup(|app| {
      restore_articles_dir_scope(app.handle());

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

/// 启动时把用户选定的文章文件夹重新加进 fs 的运行时 scope。
///
/// 为什么必须有这一步:fs 插件的运行时 scope 只活在内存里(tauri::fs::Scope 内部是
/// Mutex<HashSet<Pattern>>,每次启动重建为空)。选文件夹时 dialog 插件会自动授权,
/// 但那次授权只对本次运行有效。重启后不补授,前端第一次 readDir 就会 PathForbidden,
/// 整个文库读不出来。
///
/// 设置搬进 SQLite 后,这里也必须跟着从 SQLite 读 —— 继续读 settings.json 会拿到
/// 空值或旧值,症状就是"重启一次文章全没了"。
///
/// 授权只在 Rust 侧依据已持久化的设置来做,不暴露成 JS 可调的命令——那等于把
/// "任意目录提权"的开关交给 WebView。
fn restore_articles_dir_scope(app: &tauri::AppHandle) {
  let Ok(dir) = app.path().app_config_dir() else { return };
  let db_path = dir.join("luobi.db");
  if !db_path.exists() {
    return; // 首次运行,还没有库
  }

  // 用 SqliteConnectOptions 直接吃 PathBuf,不要拼 "sqlite:{path}" 这种 URL ——
  // Windows 路径里的反斜杠和盘符冒号在 URL 解析里不可靠,而 Windows 正是主目标平台。
  // read_only + 不 create:建库和迁移是 sql 插件的事,这里抢着建会跟它打架
  let opts = sqlx::sqlite::SqliteConnectOptions::new()
    .filename(&db_path)
    .read_only(true)
    .create_if_missing(false);
  let found = tauri::async_runtime::block_on(async move {
    let pool = sqlx::SqlitePool::connect_with(opts).await.ok()?;
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = 'articlesDir'")
      .fetch_optional(&pool)
      .await
      .ok()
      .flatten();
    pool.close().await;
    // 值是 JSON 编码的(与前端写入方式一致),所以要剥一层引号
    row.and_then(|(v,)| serde_json::from_str::<String>(&v).ok())
  });

  if let Some(d) = found.filter(|d| !d.is_empty()) {
    // recursive = false:只放行目录本身和它的直接子项,我们只在一层里写 .md。
    // 与前端 open({ directory: true, recursive: false }) 授出的 glob 保持一致
    let _ = app.fs_scope().allow_directory(&d, false);
  }
}
