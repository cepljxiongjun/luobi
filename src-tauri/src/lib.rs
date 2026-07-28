use tauri_plugin_fs::FsExt;
use tauri_plugin_store::StoreBuilder;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_store::Builder::default().build())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
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
/// 授权只在 Rust 侧依据已持久化的设置来做,不暴露成 JS 可调的命令——那等于把
/// "任意目录提权"的开关交给 WebView。
fn restore_articles_dir_scope(app: &tauri::AppHandle) {
  // disable_auto_save 要与前端 load(STORE_FILE, { autoSave: false }) 一致:
  // 同路径的 store 会复用同一个实例,先建的那个的选项说了算
  let store = match StoreBuilder::new(app, "settings.json").disable_auto_save().build() {
    Ok(s) => s,
    Err(_) => return, // 首次运行文件还不存在等情况,静默跳过
  };
  // 前端把所有设置放在 "settings" 这一个键下,不是平铺在顶层
  let settings = match store.get("settings") {
    Some(v) => v,
    None => return,
  };
  let dir = match settings.get("articlesDir").and_then(|d| d.as_str()) {
    Some(d) if !d.is_empty() => d.to_string(),
    _ => return,
  };
  // recursive = false:只放行目录本身和它的直接子项,我们只在一层里写 .md。
  // 与前端 open({ directory: true, recursive: false }) 授出的 glob 保持一致
  let _ = app.fs_scope().allow_directory(&dir, false);
}
