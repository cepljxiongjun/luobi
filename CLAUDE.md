# 落笔(Luobi)· AI 写作平台

> 本文件是从 claude.ai 会话交接过来的项目上下文,Claude Code 启动时会自动读取。

## 项目是什么

面向中文自媒体创作者的 AI 写作工具,单页 React 应用。核心工作流:
选发布平台 → 选语气 → 输入主题 → AI 生成 → 快捷改写/扩写/精简/润色 → 生成候选标题 → 复制发布。

## 当前状态(原型已完成的功能)

全部代码在 `src/LuobiApp.jsx`(单文件组件,内联样式,无 UI 库依赖):

1. **平台适配**:公众号 / 小红书 / 知乎 / 微博,各自有专属提示词规则
2. **语气风格**:专业理性 / 温暖治愈 / 犀利吐槽 / 故事叙事
3. **快捷操作**:换种写法、扩写丰富、精简压缩、润色提升(对当前正文操作)
4. **标题生成**:一次出 5 个候选,点击插入正文开头(要求模型返回 JSON 数组并解析)
5. **模型接入**(`callAI` 函数):
   - 内置通道:直连 `https://api.anthropic.com/v1/messages`,无 Key(仅在 claude.ai Artifact 沙箱内有效,见下方"已知问题")
   - 自定义接入:自定义 Host + API Key + 模型名,支持两种协议格式:
     - Claude 格式 `/v1/messages`(x-api-key 头)
     - OpenAI 兼容 `/v1/chat/completions`(Bearer 头),可接 One-API、DeepSeek、Ollama、vLLM 等
6. **Skills 写作技能系统**:
   - 可导入 .md/.txt 技能文件(兼容带 YAML frontmatter 的 SKILL.md,解析 `name:` 字段)
   - 技能可勾选启用/停用,启用后注入每次生成的系统提示词
   - 内置两个示例技能:黄金开头三板斧、爆款标题公式

## 桌面端(Tauri 2)

项目已接入 Tauri 桌面壳(`src-tauri/`),同一套 React 代码三种运行形态:

- 网络层 `proxyFetch`(LuobiApp.jsx)按环境自动选通道:
  1. Tauri 桌面端 → `@tauri-apps/plugin-http` 原生请求,无 CORS 限制
  2. 浏览器 dev → Vite 的 `/llm-proxy` 中间件转发(vite.config.js,目标地址放 `x-proxy-target` 头)
  3. 浏览器生产构建 → 直连(需目标服务允许跨域)
- 端点拼接 `buildEndpoint` 兼容各种 Host 写法:裸域名、带 `/v1`、带 `/api/paas/v4`(智谱)、完整端点
- 桌面命令:`npm run tauri dev`(开发)、`npm run tauri build`(打安装包,产物在 `src-tauri/target/release/bundle/`)
- HTTP 权限在 `src-tauri/capabilities/default.json`,已放开 http/https 全域

## 已知问题 / 本地运行注意

- **内置通道在本地不可用**:它依赖 claude.ai Artifact 环境的免鉴权代理。本地开发请用"自定义接入"模式填自己的 Key(浏览器 dev 下经 /llm-proxy 转发,桌面端原生直连)。
- 所有状态(技能、API 配置)只存在 React 内存里,刷新即失,尚无持久化。
- API Key 目前明文存在组件 state,做正式产品必须移到后端。

## 设计规范(改 UI 时必须遵守)

- 视觉:宣纸白 `#FAF9F5` 背景 + 墨色 `#23262D` 文字 + 靛蓝 `#33529C` 选中态
- **印泥红 `#B4342A` 只允许用在「落笔」主按钮上**,这是整个设计唯一的红色,不要扩散
- 标题用宋体系衬线(Songti SC),正文用黑体系(PingFang SC)
- 无 Tailwind、无 UI 组件库,全部内联样式 + 组件内 `<style>` 块,保持这个约定

## 建议的下一步(按优先级)

1. 持久化:技能库、API 配置、草稿存 localStorage 或 IndexedDB(本地环境可用)
2. 历史草稿列表 + 版本对比
3. 流式输出(SSE):两种协议格式都支持 stream,提升生成体验
4. 双模型对比生成(同一主题左右两栏出稿)
5. 后端代理层:收敛 API Key、绕开 CORS 限制

## 常用命令

```bash
npm install    # 首次安装依赖
npm run dev    # 启动开发服务器 http://localhost:5173
npm run build  # 生产构建
```
