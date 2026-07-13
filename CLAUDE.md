# 落笔(Luobi)· AI 写作平台

> 本文件是项目上下文,Claude Code 启动时会自动读取。

## 项目是什么

面向中文自媒体创作者的 AI 写作工具,React 单页应用 + Tauri 桌面壳。核心工作流:
选发布平台 → 选语气 → 输入主题 → AI 生成 → 快捷改写/扩写/精简/润色 → 生成候选标题 → 复制发布。

## 当前状态(已完成的功能)

前端代码集中在 `src/LuobiApp.jsx`(单文件组件,内联样式,无 UI 库依赖):

1. **平台适配**:公众号 / 小红书 / 知乎 / 微博,各自有专属提示词规则
2. **语气风格**:专业理性 / 温暖治愈 / 犀利吐槽 / 故事叙事
3. **快捷操作**:换种写法、扩写丰富、精简压缩、润色提升(对当前正文操作)
4. **标题系统**:独立于正文的标题栏(编辑区顶部,居中 + 加粗 + 宋体大字号);「起5个标题」生成候选,点击设为标题(再点取消),复制全文时自动拼在正文前
5. **模型接入**(`callAI` 函数):
   - 入口在主题输入卡片底部的「模型」下拉:内置三个 Claude 模型 + 自定义模型名 + 「自定义接入…」
   - 自定义接入是弹层(modal):Host + API Key + 模型名,支持两种协议格式:
     - Claude 格式 `/v1/messages`(x-api-key 头)
     - OpenAI 兼容 `/v1/chat/completions`(Bearer 头),可接 One-API、DeepSeek、智谱、Ollama、vLLM 等
   - `buildEndpoint` 兼容各种 Host 写法:裸域名、带 `/v1`(DeepSeek)、带 `/api/paas/v4`(智谱)、完整端点,自动归一化,不会拼出 `/v1/v1/...`
6. **Skills 写作技能系统**(左栏折叠面板):
   - 可导入 .md/.txt 技能文件(兼容带 YAML frontmatter 的 SKILL.md,解析 `name:` 字段)
   - 技能可勾选启用/停用,启用后注入每次生成的系统提示词
   - 内置两个示例技能:黄金开头三板斧、爆款标题公式

## 网络层(三种运行形态自动切换)

`proxyFetch`(LuobiApp.jsx)按环境选通道:

1. **Tauri 桌面端** → `@tauri-apps/plugin-http` 原生请求,无 CORS 限制
2. **浏览器 dev** → Vite 的 `/llm-proxy` 中间件转发(vite.config.js,目标地址放 `x-proxy-target` 头,只透传 content-type / x-api-key / authorization / anthropic-version)
3. **浏览器生产构建** → 直连(需目标服务允许跨域)

## 桌面端(Tauri 2)

- `src-tauri/`:标准 Tauri 2 工程,标识 `com.luobi.app`,窗口 1240×860
- HTTP 权限在 `src-tauri/capabilities/default.json`,已放开 http/https 全域
- 命令:`npm run tauri dev`(开发)、`npm run tauri build`(打安装包,产物在 `src-tauri/target/release/bundle/`)
- 需要 Rust 工具链(rustup)

## 布局约定(改 UI 前必读)

- **锁定视口布局**:根容器 `100vh + overflow hidden`,页面永远没有滚动条;左右两栏各自 `overflowY: auto` 内部滚动兜底;正文编辑卡片 `flex: 1` 自动撑满剩余高度
- 全局 CSS 重置在组件 `<style>` 块里(`html, body, #root` 清 margin、锁高度),index.html 无样式
- 左栏低频设置用 `Fold` 折叠组件(收起时标题旁显示状态摘要)
- **弹层(fixed 定位)不要放进 `position: sticky` 的容器**——sticky 会创建堆叠上下文,把弹层的 z-index 困住导致被后续内容遮挡(踩过的坑)

## 已知问题 / 本地运行注意

- **内置通道模型无 Key 会 401/403**:内置模型列表只是免配置的 UI,实际调用 api.anthropic.com 仍需鉴权。本地/桌面端请用「自定义接入」填自己的服务
- 所有状态(技能、API 配置、草稿、标题)只存在 React 内存里,刷新即失,尚无持久化
- API Key 明文存在组件 state;桌面端可后续迁到本地配置文件/系统钥匙串

## 设计规范(改 UI 时必须遵守)

- 视觉:宣纸白 `#FAF9F5` 背景 + 墨色 `#23262D` 文字 + 靛蓝 `#33529C` 选中态
- **印泥红 `#B4342A` 只允许用在「落笔」主按钮上**,这是整个设计唯一的红色,不要扩散(弹层主按钮用靛蓝)
- 标题用宋体系衬线(Songti SC),正文用黑体系(PingFang SC)
- 无 Tailwind、无 UI 组件库,全部内联样式 + 组件内 `<style>` 块,保持这个约定

## 建议的下一步(按优先级)

1. 持久化:技能库、API 配置、草稿(浏览器 localStorage;桌面端本地文件,Key 可进系统钥匙串)
2. 历史草稿列表 + 版本对比
3. 流式输出(SSE):两种协议格式都支持 stream,提升生成体验
4. 双模型对比生成(同一主题左右两栏出稿)
5. 桌面端技能文件夹监听(放入即生效)

## Git 工作流

**分支模型(GitHub Flow,单人开发从简)**

- `main`:始终可构建、可发布;CI 必须绿
- 日常小改动可直接提交到 `main`;成块的功能/重构开分支:`feat/标题栏`、`fix/zhipu-404` 这类命名,做完合回 `main`(有协作者时走 PR)
- 发版:改版本号 → 提交 → `git tag v0.1.0 && git push --tags`,release.yml 自动打包

**提交信息规范**(模板在 `.gitmessage`,已配置 `git config commit.template`)

格式 `<类型>(<范围>): <一句话描述>`,类型:`feat` / `fix` / `ui` / `refactor` / `docs` / `build` / `ci` / `chore`。示例:

```
feat(editor): 标题独立成居中加粗的标题栏
fix(proxy): 智谱 /v4 根地址被拼成 /v4/v1 导致 404
ui: 左栏低频设置折叠,默认一屏放下
```

- 一个提交只做一件事;正文写「为什么改」而不是「改了什么」
- 新克隆的机器执行一次 `git config commit.template .gitmessage` 启用模板
- PR 模板在 `.github/PULL_REQUEST_TEMPLATE.md`(含构建自查清单)

## CI / 发布(GitHub Actions)

- `.github/workflows/ci.yml`:推送到 main/master 或提 PR 时,验证网页构建(ubuntu)+ 桌面端 `cargo check`(windows)
- `.github/workflows/release.yml`:推送 `v*` tag(如 `v0.1.0`)时,自动打包 Windows 安装程序并创建 GitHub Release 草稿(tauri-action)
- 发布流程:改 `package.json` 与 `src-tauri/tauri.conf.json` 里的版本号 → 提交 → `git tag v0.1.0 && git push --tags` → 到 GitHub Releases 页把草稿发布

## 常用命令

```bash
npm install          # 首次安装依赖
npm run dev          # 网页开发 http://localhost:5173
npm run build        # 网页生产构建
npm run tauri dev    # 桌面端开发
npm run tauri build  # 桌面端打包安装程序
```
