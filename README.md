# 落笔 · AI 写作台

面向中文自媒体创作者的 AI 写作工具:选平台、定语气、一键成稿、快捷改写、候选标题。
React 单页应用 + Tauri 桌面端,同一套代码两种形态。项目详细上下文见 [CLAUDE.md](CLAUDE.md)。

## 快速开始(网页版)

```bash
npm install
npm run dev
```

打开 http://localhost:5173,点主题输入框下方的「模型 ▾」→「自定义接入…」,填入你的 API Host、Key 和模型名即可使用(支持 Claude 格式与 OpenAI 兼容格式,可接 DeepSeek、智谱、One-API、Ollama 等)。

本地开发时模型请求经 Vite 内置代理转发,无跨域问题。

## 桌面版(Tauri 2)

需要 [Rust 工具链](https://rustup.rs/):

```bash
npm run tauri dev    # 开发调试
npm run tauri build  # 打包安装程序(产物在 src-tauri/target/release/bundle/)
```

桌面端网络请求走原生层,无 CORS 限制,任何模型服务直连即可。

## 用 Claude Code 继续开发

```bash
cd luobi
claude
```

Claude Code 会自动读取 CLAUDE.md 获得完整项目背景(功能清单、网络层设计、布局与设计规范)。
