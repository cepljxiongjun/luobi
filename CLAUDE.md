# 落笔(Luobi)· AI 写作平台

> 本文件是项目上下文,Claude Code 启动时会自动读取。

## 项目是什么

面向中文自媒体创作者的 AI 写作工具,React 单页应用 + Tauri 桌面壳。核心工作流:
选发布平台 → 选语气 → 输入主题 → AI 生成 → 快捷改写/扩写/精简/润色 → 生成候选标题 → 复制发布。

## 代码结构(2026-07 重构:路由 + Tailwind)

```
src/
  main.jsx              # 入口,挂 App + index.css
  App.jsx               # HashRouter 路由表(/write /imagetext /settings)
  index.css             # Tailwind v4 入口 + @theme 设计令牌 + 全局重置/动画
  store.jsx             # AppProvider(Context):全部共享状态与动作,路由切换不丢草稿
  ui.js                 # 通用类名组合(chipCls / btnCls / inputCls / sectionLabelCls)
  components/
    Layout.jsx          # 应用外壳:左侧导航栏(笔/图/稿/设) + 顶栏 + <Outlet/>
    Fold.jsx            # 折叠面板(收起时显示状态摘要)
    SelectionToolbar.jsx# 选中正文后浮在选区上方的 AI 工具条
    ContextMenu.jsx     # 正文右键菜单(全部操作 + 自定义指令 + 复制选中 + 撤销)
    AcceptBar.jsx       # 局部改写完成后的「保留 / 撤销」条
  pages/
    WritePage.jsx       # 写作页(平台/语气/技能 + 编辑器,保存/导出 .md)
    ImageTextPage.jsx   # 图文生成页(拆卡 + 卡片预览/导出)
    ArticlesPage.jsx    # 文章库页(已保存文章:继续编辑/导出 .md/删除)
    SettingsPage.jsx    # 模型设置页(内置模型 / 自定义接入)
  lib/
    api.js              # MODELS / buildEndpoint / proxyFetch / callAI
    presets.js          # PLATFORMS / TONES / QUICK_ACTIONS / INLINE_ACTIONS / customAction
    textareaRect.js     # 镜像 div 量 textarea 选区坐标(浮条定位 + 选区高亮的地基)
    skills.js           # 内置技能 + SKILL.md 解析
    cards.js            # 图文主题/画幅/拆卡算法/canvas 导出
    storage.js          # 设置持久化:浏览器 localStorage / 桌面端 tauri-plugin-store
```

- **路由用 HashRouter**:Tauri 生产环境从本地文件加载 index.html,hash 路由不需要服务端 fallback,别改成 BrowserRouter
- **状态都在 `store.jsx` 的 Context 里**:页面组件随路由卸载,但草稿/配置/卡片全部保留;新增跨页状态一律进 store

## 已完成的功能

1. **写作页** `/write`:平台适配(公众号/小红书/知乎/微博)、语气风格、快捷操作(换写法/扩写/精简/润色/**续写**,QUICK_ACTIONS 带 `mode: replace|append`)、标题系统(「起5个标题」候选 + 独立标题栏)、Skills 写作技能(导入 .md/.txt,兼容 SKILL.md frontmatter,启用后注入系统提示词);操作条「保存」存入文章库(再次保存覆盖同一篇,`currentArticleId` 关联;新生成会重置关联)、「导出 .md」下载 Markdown(标题作 `#` 一级标题)
   - **选中局部改写**(对标秘塔/Notion AI):选中正文后**选区上方浮出工具条**(换写法/扩写/精简/润色 + `⋯` 唤起完整菜单),**正文右键**弹出完整菜单(5 个操作 + 「按我的要求改写…」自定义指令 + 复制选中 + 撤销;`Shift+右键` 让给系统菜单)。只改写选中段(prompt 带上下文衔接要求,结果替换回原位);选区状态在 WritePage(`sel`),不进 store,`runAction(action, sel)` 的 action 是鸭子类型,自定义指令用 `customAction(文本)` 现造
     - 顶部快捷操作条恒等于「改写整篇」,不再按有没有选区分裂成两种行为
     - **改写中的选区高亮 + 完成后「保留/撤销」**:AI 处理选中段时该段加靛蓝底色(自绘,受控 textarea 在改写期会丢原生选区),改完在末行下方弹接受条;`runAction` 返回模型产出的文本,据它算新范围——不能改完再读 `content`,setContent 的重渲染未必先于 await 之后的代码
     - **坐标测量**:textarea 无原生 API,`lib/textareaRect.js` 用隐藏镜像 div 复刻排版量 `getClientRects()`。宽度必须用 `clientWidth`(offsetWidth 不扣滚动条)、镜像要带尾部文本 + 零宽空格、零高度空 rect 要过滤、换算到卡片坐标要扣 `clientLeft/Top`(absolute 以 padding box 为原点,否则整层偏 1px)——这几条错一条高亮就贴不住字
   - **AI 操作撤销**:每次 AI 修改正文前 `pushHistory()` 压栈(上限 10,含 docTitle),操作条「↩ 撤销」回退;手动输入不入栈
   - **键盘快捷键**:`Ctrl/Cmd+S` 保存、`Esc` 逐层关闭(菜单 > 浮条 > 接受条)、`Ctrl/Cmd+Z` **只在接受条还在时**劫持为撤销 AI 改写,其余时刻放行给输入框原生撤销(否则手打的字就撤不了了)
   - **发布前检查**(对标零克查词,竞品单独收费的品类):AI 按当前平台查违禁词/极限词风险、错别字病句、存疑表述,返回 JSON(安全分/总评/issues),渲染成报告面板;每条可一键「应用」建议(替换首个匹配,可撤销)或「忽略」;正文再修改后报告标脏提示重查;检查不遮挡编辑器(loading === "check" 不出全屏遮罩)
   - **大纲先行**(对标光速写作):模型行「先列大纲」→ AI 出 4-6 个小节(JSON),渲染成可编辑面板(改标题/改说明/上下调序/增删/清空)→「按大纲成文」按确认后的结构成文;大纲状态在 store 的 `outline`
   - 调研留档:`docs/产品调研-2026-07.md`
2. **文章库页** `/articles`:已保存文章按更新时间排列,卡片显示标题/预览/平台/语气/字数/时间;「继续编辑」载回写作页(平台语气一并恢复)、「导出 .md」、删除(两步确认,墨色按钮——印泥红不用于此);持久化经 storage.js(浏览器 `luobi-articles-v1`,桌面端 settings.json 的 `articles` 键),防抖 300ms 自动落盘
2. **图文生成页** `/imagetext`(对标 MD2Card / ai-xiaohs / Canva 小红书模板调研结论):
   - **内容来源两种模式**:「已有文章」(手动粘贴或「带入写作草稿」)/「主题直出」(输入主题一键生成整组卡片,不需要现成文章;可选粘贴参考爆款笔记,AI 只仿其结构写法——对标 ai-xiaohs 灵感创作/爆款仿写)
   - 拆卡两条路:「AI 拆分成卡片」(callAI 输出 JSON,`normalizeCards` 校验,失败自动本地兜底)/「本地快速拆分」(`localSplitCards` 按段落句子切,不依赖模型);主题直出无兜底,失败直接报错
   - **AI 增强**(有卡片后工具条出现):「换个封面标题」生成 5 个候选 chips 点击替换封面;「生成发布文案」产出 caption+话题标签,一键复制;重新生成卡片时候选与文案自动清空
   - 4 款模板主题(宣纸墨/靛蓝夜/暖米/青瓷)、画幅 3:4(小红书首选)与 1:1、字号三档、卡片署名
   - 预览:封面卡(大标题+亮点标签)+ 内容页卡(小标题+要点+页码);DOM 预览与 canvas 导出同构
   - 导出:`drawCardCanvas` 纯 canvas 绘制(无 html2canvas 依赖),单张/全部下载 1080×1440(或 1080×1080)PNG;复制全部文案
3. **模型设置页** `/settings`:接入方式(内置/自定义)、内置模型单选、自定义接入表单(API 格式/Host/Key/模型名),修改即时生效并自动保存本机;写作页模型下拉保留快速切换,「自定义接入…」跳转设置页
   - Claude 格式 `/v1/messages`(x-api-key 头)/ OpenAI 兼容 `/v1/chat/completions`(Bearer 头),可接 One-API、DeepSeek、智谱、Ollama、vLLM 等
   - `buildEndpoint` 兼容各种 Host 写法:裸域名、带 `/v1`(DeepSeek)、带 `/api/paas/v4`(智谱)、完整端点,自动归一化,不会拼出 `/v1/v1/...`
   - **常用服务预设**(chips 一键填 Host+格式+提示):Ollama `localhost:11434` / vLLM `localhost:8000` / LM Studio `localhost:1234` / DeepSeek / 智谱 GLM
   - **自定义常用服务**:可把当前整套配置(Host/格式/Key/模型列表/当前模型)起名保存为 chip(虚线样式,同名覆盖,最多12个),点击一键切换,× 删除
   - **多模型列表**:自定义接入可配置多个模型(手动添加/测试连接结果一键加入),设置页点击切换当前使用;写作页模型下拉出现「自定义接入」分组可快速切换;旧版单模型字段自动迁移
   - **测试连接**:`listModels`(api.js)GET `{host}/v1/models`——OpenAI 兼容服务与 Anthropic 都支持;成功列出模型 chips 点击加入列表,失败给出分类错误(401 鉴权 / 404 不支持 / 无法连接)
   - 本地服务调研结论:三者均为 OpenAI 兼容协议;Ollama 无鉴权(浏览器生产直连需服务端设 `OLLAMA_ORIGINS` 放开跨域,桌面端/开发代理不受限),vLLM 启动带 `--api-key` 时需填 Key,LM Studio 需先在应用内启动本地服务器

## 网络层(三种运行形态自动切换)

`proxyFetch`(src/lib/api.js)按环境选通道:

1. **Tauri 桌面端** → `@tauri-apps/plugin-http` 原生请求,无 CORS 限制
2. **浏览器 dev** → Vite 的 `/llm-proxy` 中间件转发(vite.config.js,目标地址放 `x-proxy-target` 头,只透传 content-type / x-api-key / authorization / anthropic-version)
3. **浏览器生产构建** → 直连(需目标服务允许跨域)

### 流式输出(SSE)

- `prepareRequest(userPrompt, systemHint, api, stream)` 统一组装三种通道的请求;`callAI` 一次性、`callAIStream(..., onDelta)` 流式,两者共用 `readJsonResult` 的错误分类
- 只有**正文类生成**走流式(generate / runAction 的改写续写 / 按大纲成文,经 store 的 `runProse` 分发);标题、发布前检查、图文拆卡等 JSON 结果仍用 `callAI`
- 兼容性:响应 content-type 不是 `text/event-stream` → 自动退回一次性解析;运行环境不给 `body.getReader()`(个别 WebView)→ 整体 text 后按 SSE 解析。设置页可关闭流式
- **Vite 代理必须逐块转发**(`res.write` 循环),用 `arrayBuffer()` 整体缓冲会让流式退化成一次性返回(踩过的坑)
- SSE 分片:一条 `data:` 行可能被 TCP 切断,解析时把最后一段留在 buffer 里等下一片再拼

## 桌面端(Tauri 2)

- `src-tauri/`:标准 Tauri 2 工程,标识 `com.luobi.app`,窗口 1240×860
- HTTP 权限在 `src-tauri/capabilities/default.json`,已放开 http/https 全域
- 命令:`npm run tauri dev`(开发)、`npm run tauri build`(打安装包,产物在 `src-tauri/target/release/bundle/`)
- 需要 Rust 工具链(rustup)

## 布局约定(改 UI 前必读)

- **锁定视口布局**:根容器(Layout)`h-screen overflow-hidden`,页面永远没有滚动条;左右两栏各自 `overflow-y-auto` 内部滚动兜底;正文编辑卡片 `flex-1` 自动撑满剩余高度
- 全局 CSS 重置和 `@keyframes` 在 `src/index.css`(`html, body, #root` 清 margin、锁高度),index.html 无样式
- 左栏低频设置用 `Fold` 折叠组件(收起时标题旁显示状态摘要)
- **弹层(fixed 定位)不要放进 `position: sticky` 的容器**——sticky 会创建堆叠上下文,把弹层的 z-index 困住导致被后续内容遮挡(踩过的坑);右键菜单同理挂在右栏 `<section>` 之外
- 正文卡片内的层级:高亮层 `z-0` → 正文列 `relative z-[1]`(必须显式给,否则定位元素画在静态元素之上,色块盖住文字)→ loading 遮罩 `z-[5]` → 浮条/接受条 `z-20`;弹层里的按钮一律 `onMouseDown={e => e.preventDefault()}`,不抢 textarea 焦点才保得住选区

## 已知问题 / 本地运行注意

- **内置通道模型无 Key 会 401/403**:内置模型列表只是免配置的 UI,实际调用 api.anthropic.com 仍需鉴权。本地/桌面端请用「自定义接入」填自己的服务
- **设置已持久化**(`src/lib/storage.js` + store.jsx 水合/防抖保存):模型与 API 配置、图文外观偏好、署名。浏览器存 localStorage(`luobi-settings-v1`),桌面端由 tauri-plugin-store 存 `%APPDATA%/com.luobi.app/settings.json`(Rust 侧在 lib.rs 注册,权限 `store:default` 在 capabilities/default.json)
- 文章可手动「保存」进文章库(已持久化);未保存的草稿、标题候选、技能库、图文卡片仍只在内存,刷新即失
- API Key 明文存本机(localStorage / settings.json);桌面端后续可迁系统钥匙串

## 设计规范(改 UI 时必须遵守)

- 视觉:宣纸白 `#FAF9F5` 背景 + 墨色 `#23262D` 文字 + 靛蓝 `#33529C` 选中态
- **印泥红 `#B4342A` 只允许用在「落笔」主按钮上**,这是整个设计唯一的红色,不要扩散(其他主按钮用靛蓝)
- 标题用宋体系衬线(Songti SC),正文用黑体系(PingFang SC)
- **样式用 Tailwind CSS v4**(`@tailwindcss/vite` 插件):设计令牌在 `src/index.css` 的 `@theme` 块(`bg-paper` `text-ink` `border-line` `bg-seal` `bg-indigo` `text-ink-faint` 等),通用控件类名组合在 `src/ui.js`;仍然无 UI 组件库
- 运行时才知道的颜色(如图文卡片主题色)用内联 `style`,不要硬编码进类名

## 建议的下一步(按优先级)

1. 持久化收尾:技能库、草稿(设置已做完;复用 storage.js,Key 可进系统钥匙串)
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
