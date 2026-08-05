import { createContext, useContext, useEffect, useRef, useState } from "react";
import { MODELS, callAI, callAIStream, isTauri } from "./lib/api";
import { PLATFORMS, TONES } from "./lib/presets";
import { parseSkillFile, selectSkills, renderSkillsBlock, skillAction,
  unpackSkills, packSkills, hasDeletedBuiltins, normalizeSkill,
  serializeSkill, SKILL_COUNT_MAX, BUILTIN_SKILLS, OPS } from "./lib/skills";
import { IT_THEMES, IT_RATIOS, IT_FONT_SIZES, localSplitCards, normalizeCards, drawCardCanvas } from "./lib/cards";
import { SEARCH_PROVIDERS, SEARCH_FRESHNESS, searchConfigured, webSearch, readUrl,
  selectRefs, renderRefsBlock, renderSourceList, REF_TEXT_MAX } from "./lib/websearch";
import { loadSettings, saveSettings, saveArticles, loadSkills, saveSkills, loadDraft, saveDraft } from "./lib/storage";
import { readAll, syncAll, setSynced, firstSyncedFile, pickDir, revealDir, migrate } from "./lib/articlesFs";

// 全局状态:草稿、API 配置、技能、图文卡片都放在这里,
// 页面(路由)切换时组件卸载,但状态保留,回来草稿还在
const AppContext = createContext(null);

export function AppProvider({ children }) {
  // ---- 写作模块 ----
  const [platform, setPlatform] = useState(PLATFORMS[0]);
  const [tone, setTone] = useState(TONES[0]);
  const [topic, setTopic] = useState("");
  const [content, setContent] = useState("");
  const [docTitle, setDocTitle] = useState(""); // 文章标题:独立于正文,居中加粗展示
  const [titles, setTitles] = useState([]);
  const [loading, setLoading] = useState(null); // null | 'gen' | actionId | 'titles'
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  // ---- 模型 / API 配置 ----
  const [modelId, setModelId] = useState(MODELS[0].id);
  const [customModel, setCustomModel] = useState("");
  const [apiMode, setApiMode] = useState("builtin"); // 'builtin' | 'custom'
  const [apiFormat, setApiFormat] = useState("anthropic"); // 'anthropic' | 'openai'
  const [apiHost, setApiHost] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [customApiModel, setCustomApiModel] = useState("");   // 自定义接入当前使用的模型
  const [customModels, setCustomModels] = useState([]);       // 自定义接入的模型列表(可配多个,快速切换)
  const [savedProviders, setSavedProviders] = useState([]);   // 用户保存的常用服务 {id,name,format,host,key,models,activeModel}

  // ---- 联网:搜索源配置(用户自带 Key)+ 本次会话检索到的资料 ----
  const [searchProvider, setSearchProvider] = useState("");   // "" = 未配置,联网整体不可用
  const [searchKey, setSearchKey] = useState("");
  const [searchCount, setSearchCount] = useState(5);
  const [searchFreshness, setSearchFreshness] = useState("noLimit");
  const [readerKey, setReaderKey] = useState("");             // Jina Reader Key(可留空,免 Key 有限额)
  const [webEnabled, setWebEnabled] = useState(false);        // 总开关:关掉后既不自动检索也不注入
  const [refs, setRefs] = useState([]);        // [{id,title,url,snippet,site,date,text,picked,from}]
  const [refsLoading, setRefsLoading] = useState("");         // "" | "search" | "read" | ref.id
  const [refsError, setRefsError] = useState("");
  const [refsQuery, setRefsQuery] = useState("");             // 最近一次检索用的关键词,面板上显示

  // ---- 过程留痕:每次联网检索 / 网页抓取 / 模型调用都记一条 ----
  // 存在的理由与「资料可见可否决」同源:AI 写作最大的信任问题是"它到底拿什么写的"。
  // 稿子本身看不出这个,只有把发出去的提示词原样摆出来才看得出
  const [trace, setTrace] = useState([]);
  const traceRef = useRef([]);   // 同 refsRef:开始与结束之间会跨 await,读 state 会读到旧的
  const traceSeq = useRef(0);

  // ---- 写作技能 ----
  // 初值先给内置(带默认启用),水合完成后再换成合并了用户偏差的版本
  const [skills, setSkills] = useState(() => unpackSkills(null));
  const [skillsReady, setSkillsReady] = useState(false);
  const skillsTimer = useRef(null);

  // ---- 文章库(已保存的文章,持久化) ----
  const [articles, setArticles] = useState([]);
  const [currentArticleId, setCurrentArticleId] = useState(null); // 当前编辑器里对应的文章,再次保存时覆盖而不是新建
  const [savedFlash, setSavedFlash] = useState(false);

  // ---- 文章存储位置(桌面端可指向任意文件夹,每篇一个 .md;空 = 应用内部存储) ----
  const [articlesDir, setArticlesDir] = useState("");
  const [storageError, setStorageError] = useState(""); // 落盘失败/目录失效的人话提示
  const [storageBusy, setStorageBusy] = useState(false); // 选目录/迁移/重扫进行中
  const [migratePending, setMigratePending] = useState(null); // {dir, mine, existing} 等用户确认迁移
  const [migrateNote, setMigrateNote] = useState("");   // 迁移结果提示

  // ---- AI 操作撤销栈(只记 AI 修改正文前的快照,手动输入靠浏览器原生撤销) ----
  const [history, setHistory] = useState([]); // [{content, docTitle}],栈顶在末尾,上限 10

  // ---- 流式输出:正文类生成边收边写(个别服务不支持时 callAIStream 自动退回一次性) ----
  const [streamEnabled, setStreamEnabled] = useState(true);

  // ---- 大纲先行:主题 → 大纲(可编辑)→ 按大纲成文 ----
  const [outline, setOutline] = useState([]); // [{heading, note}]

  // ---- 发布前检查 ----
  const [checkReport, setCheckReport] = useState(null);   // {score, summary, issues:[{type,severity,excerpt,reason,suggestion,applied?,dismissed?,lost?}]}
  const [checkedContent, setCheckedContent] = useState(""); // 检查时的正文快照,用于判断报告是否过期

  // ---- 图文生成模块 ----
  const [itSource, setItSource] = useState("");        // 图文源文本
  const [itSignature, setItSignature] = useState("");  // 卡片署名
  const [itThemeId, setItThemeId] = useState(IT_THEMES[0].id);
  const [itRatioId, setItRatioId] = useState(IT_RATIOS[0].id);
  const [itFontId, setItFontId] = useState("m");
  const [itCards, setItCards] = useState(null);        // { cover, pages } | null
  const [itLoading, setItLoading] = useState(false);
  const [itError, setItError] = useState("");
  const [itNote, setItNote] = useState("");            // 拆卡方式说明(AI / 本地兜底)
  const [itCopied, setItCopied] = useState(false);
  // AI 生成(调研对标 ai-xiaohs:主题直出 / 爆款仿写 / 标题优化 / 发布文案)
  const [itMode, setItMode] = useState("article");     // 'article' 已有文章拆卡 | 'topic' 主题直出
  const [itTopic, setItTopic] = useState("");          // 主题直出:主题输入
  const [itRefNote, setItRefNote] = useState("");      // 主题直出:参考爆款笔记(可选,仿其结构风格)
  const [itRefLoading, setItRefLoading] = useState(false); // 参考笔记正从链接抓取中
  const [itTitles, setItTitles] = useState([]);        // 封面标题候选
  const [itTitlesLoading, setItTitlesLoading] = useState(false);
  const [itCaption, setItCaption] = useState("");      // 发布文案(caption + 话题标签)
  const [itCaptionLoading, setItCaptionLoading] = useState(false);
  const [itCaptionCopied, setItCaptionCopied] = useState(false);

  // ---- 设置持久化:启动时水合,变更后防抖保存 ----
  const [hydrated, setHydrated] = useState(false);
  const saveTimer = useRef(null);

  // 水合:文章库的读取必须排在设置之后——得先知道 articlesDir 才知道去哪儿读。
  // 所以两件事串在同一条 .then 链上,顺序显式,不依赖两个 effect 之间的微妙时序
  useEffect(() => {
    loadSettings().then(async s => {
      if (s) {
        if (s.apiMode === "builtin" || s.apiMode === "custom") setApiMode(s.apiMode);
        if (s.apiFormat === "anthropic" || s.apiFormat === "openai") setApiFormat(s.apiFormat);
        if (typeof s.apiHost === "string") setApiHost(s.apiHost);
        if (typeof s.apiKey === "string") setApiKey(s.apiKey);
        if (typeof s.customApiModel === "string") setCustomApiModel(s.customApiModel);
        if (Array.isArray(s.customModels)) {
          setCustomModels(s.customModels.filter(x => typeof x === "string" && x.trim()).slice(0, 50));
        } else if (typeof s.customApiModel === "string" && s.customApiModel.trim()) {
          setCustomModels([s.customApiModel.trim()]); // 兼容旧版单模型字段
        }
        if (Array.isArray(s.savedProviders)) {
          setSavedProviders(s.savedProviders
            .filter(p => p && typeof p.name === "string" && p.name.trim() && typeof p.host === "string")
            .slice(0, 12));
        }
        if (typeof s.streamEnabled === "boolean") setStreamEnabled(s.streamEnabled);
        if (SEARCH_PROVIDERS.some(p => p.id === s.searchProvider)) setSearchProvider(s.searchProvider);
        if (typeof s.searchKey === "string") setSearchKey(s.searchKey);
        if (Number.isFinite(s.searchCount)) setSearchCount(Math.min(10, Math.max(1, Math.round(s.searchCount))));
        if (SEARCH_FRESHNESS.some(f => f.id === s.searchFreshness)) setSearchFreshness(s.searchFreshness);
        if (typeof s.readerKey === "string") setReaderKey(s.readerKey);
        if (typeof s.webEnabled === "boolean") setWebEnabled(s.webEnabled);
        if (MODELS.some(m => m.id === s.modelId)) setModelId(s.modelId);
        if (typeof s.customModel === "string") setCustomModel(s.customModel);
        if (typeof s.itSignature === "string") setItSignature(s.itSignature);
        if (IT_THEMES.some(t => t.id === s.itThemeId)) setItThemeId(s.itThemeId);
        if (IT_RATIOS.some(r => r.id === s.itRatioId)) setItRatioId(s.itRatioId);
        if (IT_FONT_SIZES.some(f => f.id === s.itFontId)) setItFontId(s.itFontId);
      }
      // 存储路径只在桌面端生效,浏览器拿不到本机路径
      const dir = (isTauri && typeof s?.articlesDir === "string") ? s.articlesDir : "";
      setArticlesDir(dir);
      setHydrated(true);

      const r = await readAll(dir);
      setArticles(r.articles);
      setSynced(r.map);
      if (r.error) setStorageError(r.error);
      setArticlesReady(true);

      // 草稿恢复:必须排在文章库读完之后——currentArticleId 要对着实际存在的
      // 文章校验(文件夹可能在外部被改过)。每个字段都过防线,坏数据不上屏
      try {
        const d = await loadDraft();
        if (d && typeof d === "object") {
          const w = d.write || {};
          if (typeof w.topic === "string") setTopic(w.topic);
          if (typeof w.docTitle === "string") setDocTitle(w.docTitle);
          if (typeof w.content === "string") setContent(w.content);
          if (Array.isArray(w.titles)) setTitles(w.titles.filter(x => typeof x === "string").slice(0, 5));
          if (Array.isArray(w.outline)) {
            setOutline(w.outline.filter(o => o && (o.heading || o.note)).slice(0, 8).map(o => ({
              heading: String(o.heading || "").slice(0, 40), note: String(o.note || "").slice(0, 120),
            })));
          }
          const p = PLATFORMS.find(x => x.id === w.platformId); if (p) setPlatform(p);
          const t = TONES.find(x => x.id === w.toneId); if (t) setTone(t);
          if (w.articleId && r.articles.some(a => a.id === w.articleId)) setCurrentArticleId(w.articleId);

          if (Array.isArray(d.refs?.items)) {
            // 恢复必须走 putRefs:state 与 refsRef 镜像要同步,否则恢复后
            // 第一次落笔拼提示词读到的是空镜像
            const items = d.refs.items
              .filter(x => x && typeof x.url === "string" && x.url)
              .slice(0, 30)
              .map((x, i) => ({
                id: typeof x.id === "string" ? x.id : `r-restored-${i}`,
                title: String(x.title || ""), url: x.url,
                snippet: String(x.snippet || "").slice(0, 400),
                site: String(x.site || ""), date: String(x.date || ""),
                text: String(x.text || "").slice(0, REF_TEXT_MAX),
                picked: x.picked !== false, from: x.from === "url" ? "url" : "search",
              }));
            if (items.length) putRefs(items);
            if (typeof d.refs.query === "string") setRefsQuery(d.refs.query);
          }

          const it = d.it || {};
          if (it.mode === "topic" || it.mode === "article") setItMode(it.mode);
          if (typeof it.source === "string") setItSource(it.source);
          if (typeof it.topic === "string") setItTopic(it.topic);
          if (typeof it.refNote === "string") setItRefNote(it.refNote);
          if (typeof it.caption === "string") setItCaption(it.caption);
          if (it.cards) { const c = normalizeCards(it.cards); if (c) setItCards(c); }
        }
      } catch { /* 草稿坏了就当没有,绝不因此打不开应用 */ }
      setDraftReady(true);
    });
  }, []);

  // ---- 草稿持久化:变更后防抖保存(比设置的 300ms 松,正文是逐字敲的) ----
  const [draftReady, setDraftReady] = useState(false);
  const draftTimer = useRef(null);
  useEffect(() => {
    if (!draftReady) return; // 恢复完成前不回写,避免默认空值覆盖已存草稿
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => saveDraft({
      v: 1,
      write: { topic, docTitle, content, titles, outline,
        platformId: platform.id, toneId: tone.id, articleId: currentArticleId },
      refs: { query: refsQuery, items: refs },
      it: { mode: itMode, source: itSource, topic: itTopic, refNote: itRefNote,
        cards: itCards, caption: itCaption },
    }), 800);
    return () => clearTimeout(draftTimer.current);
  }, [draftReady, topic, docTitle, content, titles, outline, platform, tone, currentArticleId,
    refs, refsQuery, itMode, itSource, itTopic, itRefNote, itCards, itCaption]);

  useEffect(() => {
    if (!hydrated) return; // 水合完成前不回写,避免默认值覆盖已存设置
    clearTimeout(saveTimer.current);
    // articlesDir 必须落进 settings.json:Rust 侧启动时就是从这里读回路径,
    // 重新给 fs 运行时 scope 授权的(运行时 scope 不持久化,见 src-tauri/src/lib.rs)
    const snapshot = { apiMode, apiFormat, apiHost, apiKey, customApiModel, customModels, savedProviders,
      modelId, customModel, streamEnabled, itSignature, itThemeId, itRatioId, itFontId, articlesDir,
      searchProvider, searchKey, searchCount, searchFreshness, readerKey, webEnabled };
    saveTimer.current = setTimeout(() => saveSettings(snapshot), 300);
    return () => clearTimeout(saveTimer.current);
  }, [hydrated, apiMode, apiFormat, apiHost, apiKey, customApiModel, customModels, savedProviders,
    modelId, customModel, streamEnabled, itSignature, itThemeId, itRatioId, itFontId, articlesDir,
    searchProvider, searchKey, searchCount, searchFreshness, readerKey, webEnabled]);

  // ---- 技能库持久化:独立键,与设置互不干扰 ----
  useEffect(() => {
    loadSkills().then(stored => {
      setSkills(unpackSkills(stored)); // 内置只存偏差,这里与最新的 BUILTIN_SKILLS 合并
      setSkillsReady(true);
    });
  }, []);

  useEffect(() => {
    if (!skillsReady) return; // 水合完成前不回写,避免默认值覆盖已存技能
    clearTimeout(skillsTimer.current);
    skillsTimer.current = setTimeout(() => saveSkills(packSkills(skills)), 300);
    return () => clearTimeout(skillsTimer.current);
  }, [skillsReady, skills]);

  // ---- 文章库持久化:变更后防抖增量同步(水合在上面那条设置链里) ----
  const [articlesReady, setArticlesReady] = useState(false);
  const articlesTimer = useRef(null);

  useEffect(() => {
    if (!articlesReady) return;
    clearTimeout(articlesTimer.current);
    articlesTimer.current = setTimeout(async () => {
      // 增量:只写 updatedAt 变了的那几篇,不是每次全量重写整个文件夹
      const r = await syncAll(articlesDir, articles);
      setStorageError(r.error || "");
    }, 300);
    return () => clearTimeout(articlesTimer.current);
  }, [articlesReady, articles, articlesDir]);

  // ---- 存储位置的动作 ----

  // 选文件夹。dialog 选中时会自动给 fs 运行时 scope 授权,所以之后就能读写它了
  const pickArticlesDir = async () => {
    setMigrateNote(""); setStorageError("");
    setStorageBusy(true);
    try {
      const dir = await pickDir();
      if (!dir) return; // 用户取消
      const r = await readAll(dir);
      if (r.fatal) {
        setStorageError(r.error);
        return; // 这个目录根本读不了,不落配置,应用照常用内部存储
      }
      setSynced(r.map);
      const mine = articles.filter(a => !r.map.has(a.id));
      if (mine.length > 0) {
        // 让用户决定要不要把现有文章复制过去,不擅自搬家
        setMigratePending({ dir, mine, existing: r.articles.length, folderArticles: r.articles });
      } else {
        setArticlesDir(dir);
        setArticles(r.articles);
        setMigrateNote(r.articles.length ? `已接管文件夹里的 ${r.articles.length} 篇` : "文件夹已就绪");
      }
    } catch (e) {
      setStorageError(`选择文件夹失败:${(e?.message || "").slice(0, 80)}`);
    } finally {
      setStorageBusy(false);
    }
  };

  // 迁移确认。copy=false 表示只用文件夹里已有的,内存里的留在内部存储不动
  const confirmMigrate = async (copy) => {
    const p = migratePending;
    if (!p) return;
    setMigratePending(null); setStorageBusy(true);
    try {
      let note = "";
      if (copy) {
        const { ok, fail, reason } = await migrate(p.dir, p.mine);
        note = fail
          ? `已迁移 ${ok}/${ok + fail} 篇,${fail} 篇写入失败:${reason}`
          : `已迁移 ${ok} 篇到新位置`;
        // 迁移永不破坏性:内部存储里的旧数据一个字都不删,留着当安全网
        setArticles([...p.folderArticles, ...p.mine]);
      } else {
        setArticles(p.folderArticles);
        note = `已切换到文件夹里的 ${p.folderArticles.length} 篇`;
      }
      setArticlesDir(p.dir);
      setMigrateNote(note);
    } finally {
      setStorageBusy(false);
    }
  };

  // 恢复默认存储:先把当前文章写回内部存储,再清路径。磁盘上的 .md 一个都不删
  const resetArticlesDir = async () => {
    setStorageBusy(true);
    try {
      await saveArticles(articles);
      setSynced(new Map());
      setArticlesDir("");
      setStorageError("");
      setMigrateNote("已恢复为应用内部存储,文件夹里的 .md 文件保持原样");
    } finally {
      setStorageBusy(false);
    }
  };

  const openArticlesDir = () => {
    return revealDir(articlesDir, firstSyncedFile());
  };

  // 重新扫描:用户可能在 Obsidian/资源管理器里直接改了文件。
  // 冲突策略——磁盘赢,但正在编辑器里打开的那篇不覆盖,免得冲掉没保存的改动
  const rescanArticles = async () => {
    if (!articlesDir) return;
    setStorageBusy(true);
    try {
      const r = await readAll(articlesDir);
      setSynced(r.map);
      setStorageError(r.error || "");
      const keep = articles.find(a => a.id === currentArticleId);
      setArticles(keep && !r.articles.some(a => a.id === keep.id) ? [...r.articles, keep] : r.articles);
    } finally {
      setStorageBusy(false);
    }
  };

  // ---- 派生值 ----
  const itTheme = IT_THEMES.find(t => t.id === itThemeId);
  const itRatio = IT_RATIOS.find(r => r.id === itRatioId);
  const itScale = IT_FONT_SIZES.find(f => f.id === itFontId).scale;

  // 当前实际生效的模型:自定义模式下取输入框的值(为空则回退默认)
  const activeModel = apiMode === "custom"
    ? customApiModel.trim()
    : (modelId === "__custom__" ? customModel.trim() || "claude-sonnet-4-6" : modelId);

  // 汇总当前 API 配置,传给调用层
  const apiConfig = () => ({ mode: apiMode, format: apiFormat, host: apiHost, key: apiKey, model: activeModel });

  const enabledSkills = skills.filter(s => s.enabled);

  // 折叠面板/下拉收起时显示的状态摘要
  const modelSummary = apiMode === "custom"
    ? (customApiModel.trim() ? `自定义 · ${customApiModel.trim()}` : "自定义 · 未配置")
    : (modelId === "__custom__" ? activeModel : MODELS.find(m => m.id === modelId)?.name);

  // 当前平台下「落笔成文」会实际注入哪些技能:左栏用它显示生效数与超预算提示。
  // 用 draft 当代表性场景——不同操作注入的条数会变,摘要不可能逐个列
  const skillPlan = selectSkills(skills, { op: "draft", platformId: platform.id });
  const skillSummary = enabledSkills.length === 0 ? "未启用"
    : `${skillPlan.used.length} 项生效` + (skillPlan.dropped.length ? ` · ${skillPlan.dropped.length} 项超预算` : "");

  // 算出当前上下文该注入的技能文本。platformId 可覆盖:图文页的产物恒定是小红书卡片,
  // 与写作页当前选的平台无关,所以那边固定传 "xhs"
  const skillsFor = (op, platformId = platform.id) =>
    renderSkillsBlock(selectSkills(skills, { op, platformId }).used);

  // ---- 联网:派生值与注入 ----
  // refs 的权威副本另放一份在 ref 里:自动检索完紧接着就要拼提示词,而 setRefs 触发的
  // 重渲染不保证发生在 await 之后那行代码之前(与局部改写"不能改完再读 content"同源)。
  // 所有改动都走 putRefs,state 与镜像永远同时更新
  const refsRef = useRef([]);
  const putRefs = (next) => { refsRef.current = next; setRefs(next); };

  const searchCfg = () => ({ provider: searchProvider, key: searchKey,
    count: searchCount, freshness: searchFreshness, readerKey });
  const webReady = searchConfigured(searchCfg());   // 选了源且填了 Key 才算能联网
  const webOn = webEnabled && webReady;             // 总开关也打开了,这次才真的会联网
  const refPlan = selectRefs(refs);
  const pickedRefs = refs.filter(r => r.picked !== false);
  const webSummary = !webReady ? "未配置"
    : !webEnabled ? "已关闭"
    : refs.length === 0 ? "已开启 · 落笔前自动查资料"
    : `${refPlan.used.length} 条资料生效` + (refPlan.dropped.length ? ` · ${refPlan.dropped.length} 条超预算` : "");

  // **只给"要产出新内容"的操作注入资料**。换写法/精简/润色/起标题面对的是已经写好的正文,
  // 塞一堆外部资料进去只会诱导模型往里加原文没有的东西——那是改写,不是重写
  const REF_OPS = ["draft", "outline", "expand", "continue", "custom", "cards", "caption", "check"];
  // check 拿到的是"核对用"的规则版本,与写作那套刚好相反(见 websearch.js 的 REF_RULES)
  const refsFor = (op) =>
    (webOn && REF_OPS.includes(op) ? renderRefsBlock(refsRef.current, op === "check" ? "verify" : "write") : "");

  // op 决定注入哪些技能(技能可声明只在起标题/只在改写时生效)与要不要带上联网资料
  const baseHint = (op = "draft") =>
    `你是一位资深自媒体写作者。写作平台:${platform.prompt} 语气风格:${tone.name}(${tone.desc})。`
    + skillsFor(op) + refsFor(op);

  // ---- 过程留痕:动作 ----
  const TRACE_MAX = 30; // 只留最近这么多步,过程面板不是日志系统

  const traceStart = (kind, label, detail = {}) => {
    const id = `s-${++traceSeq.current}`;
    const next = [...traceRef.current, { id, kind, label, detail, status: "running", at: Date.now(), ms: 0 }];
    traceRef.current = next.slice(-TRACE_MAX);
    setTrace(traceRef.current);
    return id;
  };

  const traceEnd = (id, patch = {}) => {
    const next = traceRef.current.map(s => s.id === id
      ? { ...s, detail: { ...s.detail, ...(patch.detail || {}) },
          error: patch.error, status: patch.error ? "failed" : "done", ms: Date.now() - s.at }
      : s);
    traceRef.current = next;
    setTrace(next);
  };

  const clearTrace = () => { traceRef.current = []; setTrace([]); };

  // 悬浮球显示的当前活动:同一时刻只可能有一个(所有入口都被 loading 态互斥)
  const activity = trace.find(s => s.status === "running") || null;

  // 一次模型调用的留痕。system 已经拼好了(技能与资料都在里面),这里额外把
  // "注入了哪几条"单列出来——面板里读一整段提示词太费劲,先给结论再给全文
  const traceModel = (op, prompt, system, platformId = platform.id, label) => traceStart(
    "model", label || OPS[op] || op,
    {
      system, user: prompt, model: activeModel, op,
      skills: selectSkills(skills, { op, platformId }).used.map(s => s.name),
      refs: (webOn && REF_OPS.includes(op)) ? selectRefs(refsRef.current).used.map(r => r.title) : [],
    },
  );

  // 非正文类(要 JSON 的)模型调用统一从这里走,好让过程面板也记上一笔
  const runJson = async (op, prompt, system, platformId = platform.id, label) => {
    const id = traceModel(op, prompt, system, platformId, label);
    try {
      const text = await callAI(prompt, system, apiConfig());
      traceEnd(id, { detail: { result: text } });
      return text;
    } catch (e) { traceEnd(id, { error: e.message || "调用失败" }); throw e; }
  };

  // ---- 选题灵感(对标易撰的热点选题):领域词 → 检索当下讨论 → 提炼成选题卡 ----
  // 检索结果刻意不进 refs 面板:它们是"写什么"的素材,不是"怎么写"的资料,
  // 混进去会污染落笔时注入的内容。用户点了某个选题后,现有的自动检索会按
  // 新主题再查一次,链路天然衔接。
  // 选题结果也不随草稿持久化——热点有时效性,过夜就馊了,刻意只留会话内
  const [inspo, setInspo] = useState([]);          // [{title, angle, why}]
  const [inspoLoading, setInspoLoading] = useState(false);
  const [inspoError, setInspoError] = useState("");
  const [inspoField, setInspoField] = useState(""); // 最近一次用的领域词

  const genTopicIdeas = async (field) => {
    const f = String(field || "").trim();
    if (!f) { setInspoError("先写一个领域词,比如「职场」「AI」「育儿」"); return; }
    if (!webReady) { setInspoError("选题灵感需要联网:请到设置页配置搜索源"); return; }
    setInspoError(""); setInspoLoading(true);
    const t = traceStart("web", `检索「${f}」的热点讨论`, {
      query: f, provider: searchProvider, freshness: "oneWeek", count: 8,
    });
    try {
      // 时效写死一周内:选题要的就是"现在大家在聊什么",跟着全局时效设置反而不对
      const list = await webSearch(`${f} 热点 讨论 争议`, { ...searchCfg(), count: 8, freshness: "oneWeek" });
      traceEnd(t, { detail: { results: list } });
      const material = list.map((r, i) =>
        `${i + 1}. ${r.title}${r.date ? `(${r.date})` : ""}\n${r.snippet}`).join("\n\n");
      const raw = await runJson("inspire",
        `下面是「${f}」领域最近一周的讨论。请从中提炼 5-8 个适合${platform.name}的选题,` +
        `要求:每个选题有明确的切入角度、能说清"为什么现在写"(蹭到了哪个讨论),不要泛泛的常青题。` +
        `只返回JSON数组,不要markdown代码块,格式:` +
        `[{"title":"选题,15-25字","angle":"切入角度,15-30字","why":"为什么现在写,20-40字"}]\n\n${material}`,
        `你是资深${platform.name}选题策划,擅长从当下讨论里找到有传播潜力又不同质化的切入点。`,
        platform.id, "选题灵感");
      const arr = JSON.parse(raw.replace(/```json|```/g, "").trim());
      if (!Array.isArray(arr) || arr.length === 0) throw new Error("返回格式异常");
      setInspo(arr.slice(0, 8).map(x => ({
        title: String(x.title || "").slice(0, 40),
        angle: String(x.angle || "").slice(0, 60),
        why: String(x.why || "").slice(0, 80),
      })).filter(x => x.title));
      setInspoField(f);
    } catch (e) {
      // 失败可能出在检索(t 还挂着)或提炼(t 已收尾、runJson 自己留了失败痕)
      if (traceRef.current.some(s => s.id === t && s.status === "running")) traceEnd(t, { error: e.message });
      setInspoError(`选题生成失败:${(e.message || "请重试").slice(0, 80)}`);
    }
    setInspoLoading(false);
  };

  // 点选题:主题框填入「选题 —— 切入角度」,让落笔时模型直接拿到角度
  const pickTopicIdea = (idea) => {
    setTopic(idea.angle ? `${idea.title} —— ${idea.angle}` : idea.title);
  };
  const clearInspo = () => { setInspo([]); setInspoError(""); setInspoField(""); };

  // ---- 联网:动作 ----
  const REF_LIST_MAX = 30; // 面板里最多留这么多条,再多用户自己也管不过来

  // 检索并把结果**并进**资料列表而不是替换:一个选题常要换几个关键词各搜一次,
  // 后一次把前一次冲掉的话,用户会在两批结果之间反复横跳
  const searchRefs = async (query) => {
    const q = String(query || "").trim();
    if (!q) { setRefsError("先写下要查什么"); return 0; }
    if (!webReady) { setRefsError("还没有配置联网搜索:请到设置页选择搜索源并填入 Key"); return 0; }
    setRefsError(""); setRefsLoading("search");
    const t = traceStart("web", `检索「${q}」`, {
      query: q, provider: searchProvider, freshness: searchFreshness, count: searchCount,
    });
    try {
      const list = await webSearch(q, searchCfg());
      const stamped = list.map((r, i) => ({
        ...r, id: `r-${Date.now()}-${i}`, text: "", picked: true, from: "search",
      }));
      const seen = new Set(refsRef.current.map(r => r.url));
      putRefs([...refsRef.current, ...stamped.filter(r => !seen.has(r.url))].slice(0, REF_LIST_MAX));
      setRefsQuery(q);
      traceEnd(t, { detail: { results: list } });
      return list.length;
    } catch (e) { traceEnd(t, { error: e.message }); setRefsError(e.message || "检索失败,请重试"); return 0; }
    finally { setRefsLoading(""); }
  };

  // 直接贴链接:抓正文入库。用户手里往往已经有那篇要参考的报道/爆款笔记,
  // 让他再去搜一遍关键词把它找出来是荒唐的
  const addRefByUrl = async (u) => {
    const link = String(u || "").trim();
    if (!link) return false;
    setRefsError(""); setRefsLoading("read");
    const t = traceStart("read", "抓取网页正文", { url: link });
    try {
      const page = await readUrl(link, searchCfg());
      traceEnd(t, { detail: { title: page.title, chars: page.text.length, text: page.text } });
      if (refsRef.current.some(r => r.url === page.url)) { setRefsError("这条链接已经在资料里了"); return false; }
      putRefs([...refsRef.current, {
        id: `r-${Date.now()}`, title: page.title, url: page.url, site: page.site, date: page.date,
        snippet: page.text.slice(0, 300), text: page.text, picked: true, from: "url",
      }].slice(0, REF_LIST_MAX));
      return true;
    } catch (e) { traceEnd(t, { error: e.message }); setRefsError(e.message || "抓取失败,请重试"); return false; }
    finally { setRefsLoading(""); }
  };

  // 把某条搜索结果的摘要换成整篇正文。搜索返回的摘要只有一两句,
  // 真要引用数据得看原文——但抓正文慢且吃额度,所以做成按条手动触发
  const fetchRefText = async (id) => {
    const r = refsRef.current.find(x => x.id === id);
    if (!r || r.text) return;
    setRefsError(""); setRefsLoading(id);
    const t = traceStart("read", "抓取网页正文", { url: r.url });
    try {
      const page = await readUrl(r.url, searchCfg());
      traceEnd(t, { detail: { title: page.title, chars: page.text.length, text: page.text } });
      putRefs(refsRef.current.map(x => x.id === id
        ? { ...x, text: page.text.slice(0, REF_TEXT_MAX), title: x.title || page.title } : x));
    } catch (e) { traceEnd(t, { error: e.message }); setRefsError(e.message || "抓取失败,请重试"); }
    finally { setRefsLoading(""); }
  };

  const toggleRef = (id) => putRefs(refsRef.current.map(r => r.id === id ? { ...r, picked: r.picked === false } : r));
  const removeRef = (id) => putRefs(refsRef.current.filter(r => r.id !== id));
  const clearRefs = () => { putRefs([]); setRefsError(""); setRefsQuery(""); };

  // 把勾选的来源作为清单追加到正文末尾。**不自动加**——知乎需要、小红书绝不需要,
  // 这个判断只有用户能下
  const insertSources = () => {
    const list = renderSourceList(refsRef.current);
    if (!list) return;
    pushHistory();
    setContent(content.trim() ? `${content.trim()}\n\n${list}` : list);
  };

  // 开着联网但一条资料都还没有时,动笔前先替用户查一次。
  // 已经有资料就不再自动检索:那是用户手动搜过、挑过的,不该被覆盖。
  // 检索失败**不阻断写作**,只留下错误提示——联网是增强,不是前置条件
  const autoRefs = async (subject) => {
    if (!webOn || refsRef.current.length > 0) return;
    await searchRefs(subject);
  };

  // ---- 写作:动作 ----
  const importSkills = (fileList) => {
    const files = Array.from(fileList || []);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || "").trim();
        if (!text) { setError(`「${file.name}」是空文件,已跳过`); return; }
        const parsed = parseSkillFile(file.name, text);
        if (!parsed) { setError(`「${file.name}」没有正文内容,已跳过`); return; }
        setSkills(prev => {
          if (prev.filter(s => !s.builtin).length >= SKILL_COUNT_MAX) {
            setError(`技能最多 ${SKILL_COUNT_MAX} 条,「${file.name}」未导入`);
            return prev;
          }
          // 同名用户技能覆盖(沿用常用服务的同名覆盖范式);与内置同名则加后缀,不许顶掉内置
          const clash = prev.find(s => s.name === parsed.name);
          if (clash?.builtin) return [...prev, { ...parsed, name: `${parsed.name}(导入)`.slice(0, 30) }];
          if (clash) return prev.map(s => s.id === clash.id ? { ...parsed, id: s.id } : s);
          return [...prev, parsed];
        });
      };
      reader.onerror = () => setError(`读取「${file.name}」失败,请重试`);
      reader.readAsText(file);
    });
  };

  const toggleSkill = (id) => setSkills(prev => prev.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s));
  const removeSkill = (id) => setSkills(prev => prev.filter(s => s.id !== id));

  // 新建一条空技能,返回它的 id 供调用方选中
  const addSkill = () => {
    const id = `sk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setSkills(prev => {
      if (prev.filter(s => !s.builtin).length >= SKILL_COUNT_MAX) {
        setError(`技能最多 ${SKILL_COUNT_MAX} 条,请先删掉一些`);
        return prev;
      }
      return [...prev, normalizeSkill({
        id, name: "新技能", content: "在这里写下写作规范。\n\n好的技能要有:可数的硬约束、具体的禁用词、正反例、自检清单。",
        builtin: false, enabled: false,
      })];
    });
    return id;
  };

  // 编辑技能。改内置技能会打 edited 标记,这样以后我升级内置内容时不会覆盖掉用户的版本
  const updateSkill = (id, patch) => setSkills(prev => prev.map(s => {
    if (s.id !== id) return s;
    const next = normalizeSkill({ ...s, ...patch }) || s;
    return s.builtin && ("content" in patch || "name" in patch) ? { ...next, edited: true } : next;
  }));

  // 内置技能还原为默认:清掉 edited 标记与自定义内容,重新取当前版本的内置定义
  const resetBuiltinSkill = (id) => setSkills(prev => prev.map(s => {
    if (s.id !== id || !s.builtin) return s;
    const def = BUILTIN_SKILLS.find(b => b.id === id);
    return def ? { ...normalizeSkill({ ...def, enabled: s.enabled }), edited: false } : s;
  }));

  // 恢复被删掉的内置技能(墓碑清理)
  const restoreBuiltinSkills = () => setSkills(prev => {
    const have = new Set(prev.map(s => s.id));
    const back = BUILTIN_SKILLS.filter(b => !have.has(b.id))
      .map(b => normalizeSkill({ ...b, enabled: b.defaultEnabled }));
    return back.length ? [...prev, ...back] : prev;
  });

  const exportSkillMd = (s) => {
    const blob = new Blob([serializeSkill(s)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url;
    el.download = `${(s.name || "技能").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40)}.md`;
    el.click();
    setTimeout(() => URL.revokeObjectURL(url), 120);
  };

  // ---- 自定义接入:模型列表管理 ----
  const addCustomModel = (name) => {
    const n = String(name || "").trim();
    if (!n) return;
    setCustomModels(prev => prev.includes(n) ? prev : [...prev, n]);
    setCustomApiModel(n); // 新添加的模型直接设为当前使用
  };
  const removeCustomModel = (name) => {
    const next = customModels.filter(m => m !== name);
    setCustomModels(next);
    if (customApiModel === name) setCustomApiModel(next[0] || "");
  };

  // ---- 自定义接入:保存/应用命名的常用服务 ----
  const saveProvider = (name) => {
    const n = String(name || "").trim().slice(0, 20);
    if (!n || !apiHost.trim()) return;
    const entry = { id: `sp-${Date.now()}`, name: n, format: apiFormat, host: apiHost.trim(),
      key: apiKey, models: customModels, activeModel: customApiModel };
    setSavedProviders(prev => {
      const i = prev.findIndex(p => p.name === n);
      if (i >= 0) { const next = [...prev]; next[i] = { ...entry, id: prev[i].id }; return next; } // 同名覆盖
      return [...prev, entry].slice(0, 12);
    });
  };
  const removeProvider = (id) => setSavedProviders(prev => prev.filter(p => p.id !== id));
  const applyProvider = (p) => {
    setApiMode("custom");
    setApiFormat(p.format === "anthropic" ? "anthropic" : "openai");
    setApiHost(p.host || "");
    setApiKey(typeof p.key === "string" ? p.key : "");
    const models = Array.isArray(p.models) ? p.models.filter(x => typeof x === "string" && x.trim()) : [];
    setCustomModels(models);
    setCustomApiModel(p.activeModel && models.includes(p.activeModel) ? p.activeModel : (models[0] || ""));
  };

  // ---- 撤销:AI 修改正文前压栈,可一键回退 ----
  const pushHistory = () => {
    setHistory(prev => [...prev, { content, docTitle }].slice(-10));
  };
  const undoLast = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setContent(last.content);
    setDocTitle(last.docTitle);
    setHistory(prev => prev.slice(0, -1));
  };

  // ---- 文章库:保存 / 打开 / 删除 / 导出 .md ----
  const saveArticle = () => {
    if (!content.trim() && !docTitle.trim()) return;
    // 严格单调:同一毫秒内连按两次保存会让 updatedAt 相同,增量同步就会把第二次
    // 当成"没变过"漏写。+1 保证时间戳一定往前走,diff 才可靠
    const prevArt = articles.find(a => a.id === currentArticleId);
    const now = Math.max(Date.now(), (prevArt?.updatedAt || 0) + 1);
    const base = { title: docTitle.trim(), content, topic, platformId: platform.id, toneId: tone.id, updatedAt: now };
    if (currentArticleId && articles.some(a => a.id === currentArticleId)) {
      setArticles(prev => prev.map(a => a.id === currentArticleId ? { ...a, ...base } : a));
    } else {
      const id = `a-${now}-${Math.random().toString(36).slice(2, 7)}`;
      setArticles(prev => [{ id, createdAt: now, ...base }, ...prev]);
      setCurrentArticleId(id);
    }
    setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1600);
  };

  const openArticle = (id) => {
    const a = articles.find(x => x.id === id);
    if (!a) return;
    setDocTitle(a.title || "");
    setContent(a.content || "");
    setTopic(a.topic || "");
    const p = PLATFORMS.find(x => x.id === a.platformId); if (p) setPlatform(p);
    const t = TONES.find(x => x.id === a.toneId); if (t) setTone(t);
    setTitles([]); setError("");
    setCurrentArticleId(id);
  };

  const deleteArticle = (id) => {
    setArticles(prev => prev.filter(a => a.id !== id));
    if (currentArticleId === id) setCurrentArticleId(null);
  };

  // 导出为 Markdown 文件(标题作一级标题;文件名取标题,过滤非法字符)
  const exportMd = (a) => {
    const title = (a.title || "").trim();
    const body = a.content || "";
    const md = title ? `# ${title}\n\n${body}` : body;
    if (!md.trim()) return;
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url;
    el.download = `${(title || "未命名文章").replace(/[\\/:*?"<>|]/g, "_").slice(0, 50)}.md`;
    el.click();
    setTimeout(() => URL.revokeObjectURL(url), 120);
  };
  const exportCurrentMd = () => exportMd({ title: docTitle, content });

  // 正文类生成的统一入口:开启流式时边收边写进编辑器,否则一次性写入
  // apply(文本) 由调用方决定怎么落到正文(整篇替换 / 拼回选区 / 追加到末尾)
  const runProse = async (prompt, apply, op = "draft") => {
    const system = baseHint(op); // 只拼一次:它同时要发给模型和记进过程面板
    const id = traceModel(op, prompt, system);
    try {
      const text = streamEnabled
        ? await callAIStream(prompt, system, apiConfig(), apply)
        : await callAI(prompt, system, apiConfig());
      apply(text); // 收尾用 trim 过的最终结果覆盖一次
      traceEnd(id, { detail: { result: text } });
      return text;
    } catch (e) { traceEnd(id, { error: e.message || "调用失败" }); throw e; }
  };

  const generate = async () => {
    if (!topic.trim()) { setError("先写下你想聊的主题"); return; }
    if (content.trim() || docTitle.trim()) pushHistory(); // 覆盖已有内容前留快照,可撤销
    setError(""); setLoading("gen"); setTitles([]); setDocTitle("");
    setCurrentArticleId(null); // 新生成的是新文章,保存时不覆盖旧文
    try {
      await autoRefs(topic.trim()); // 开了联网就先查资料,查不到也照常写
      await runProse(`请围绕这个主题创作一篇内容:「${topic.trim()}」`, setContent);
    } catch (e) { setError(e.message || "生成失败了,请再试一次"); }
    setLoading(null);
  };

  // ---- 大纲先行:先出结构再成文,长文更有逻辑推进 ----
  const genOutline = async () => {
    if (!topic.trim()) { setError("先写下你想聊的主题"); return; }
    setError(""); setLoading("outline");
    try {
      await autoRefs(topic.trim()); // 大纲最吃"这个领域现在在讨论什么",联网收益比成文还大
      const raw = await runJson("outline",
        `请为主题「${topic.trim()}」列一份适合${platform.name}的写作大纲,4-6个小节,循序渐进、有逻辑推进,不要写正文。` +
        `只返回JSON数组,不要markdown代码块,格式:[{"heading":"小节标题,12字内","note":"这一节要写什么,25-40字"}]`,
        baseHint("outline"));
      const arr = JSON.parse(raw.replace(/```json|```/g, "").trim());
      if (!Array.isArray(arr) || arr.length === 0) throw new Error("返回格式异常");
      setOutline(arr.slice(0, 8).map(x => ({
        heading: String(x.heading || "").slice(0, 40),
        note: String(x.note || "").slice(0, 120),
      })));
    } catch (e) { setError(`大纲生成失败:${(e.message || "请重试").slice(0, 80)}`); }
    setLoading(null);
  };

  const updateOutlineItem = (i, patch) => setOutline(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  const removeOutlineItem = (i) => setOutline(prev => prev.filter((_, idx) => idx !== i));
  const addOutlineItem = () => setOutline(prev => [...prev, { heading: "", note: "" }]);
  const moveOutlineItem = (i, dir) => setOutline(prev => {
    const j = i + dir;
    if (j < 0 || j >= prev.length) return prev;
    const next = [...prev];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const clearOutline = () => setOutline([]);

  const writeFromOutline = async () => {
    const secs = outline.filter(s => s.heading.trim() || s.note.trim());
    if (secs.length === 0) { setError("大纲是空的,先生成或手动添加小节"); return; }
    if (content.trim() || docTitle.trim()) pushHistory();
    setError(""); setLoading("gen"); setTitles([]);
    setCurrentArticleId(null);
    try {
      const outlineText = secs.map((s, i) => `${i + 1}. ${s.heading}${s.note ? ` —— ${s.note}` : ""}`).join("\n");
      const subject = topic.trim() || secs[0].heading;
      await runProse(
        `请围绕主题「${subject}」,严格按下面这份大纲写成一篇完整文章:每个小节都要充分展开,` +
        `小节之间过渡自然,不要保留大纲的序号和破折号说明。\n\n${outlineText}`,
        setContent
      );
    } catch (e) { setError(e.message || "生成失败了,请再试一次"); }
    setLoading(null);
  };

  // sel = {start, end} | null:有有效选区时快捷操作只改写选中段,其余正文不动
  // 返回模型产出的文本(失败返回 null),调用方据此判断这次改动的范围——
  // 不能改完再去读 content,setContent 的重渲染未必先于 await 的后续代码执行
  const runAction = async (action, sel) => {
    if (!content.trim()) return null;
    const selValid = action.mode !== "append" && sel &&
      Number.isInteger(sel.start) && Number.isInteger(sel.end) &&
      sel.start >= 0 && sel.start < sel.end && sel.end <= content.length;
    setError(""); setLoading(action.id);
    pushHistory(); // 流式会边写边改正文,快照必须先留;中途失败也能撤销回改前状态
    let out = null;
    try {
      if (selValid) {
        // 选区局部改写:带上下文提示衔接,结果只替换选中段
        const before = content.slice(0, sel.start);
        const selText = content.slice(sel.start, sel.end);
        const after = content.slice(sel.end);
        const prompt = `${action.prompt}\n\n${selText}\n\n` +
          `(注意:这是文章中的一个片段,上文结尾是「…${before.slice(-120)}」,下文开头是「${after.slice(0, 120)}…」,` +
          `改写结果必须与上下文自然衔接,只输出改写后的片段本身)`;
        out = await runProse(prompt, t => setContent(before + t + after), action.op || action.id);
      } else if (action.mode === "append") {
        // 续写:结果追加到正文末尾
        const base = content.trim();
        out = await runProse(`${action.prompt}\n\n${content}`, t => setContent(`${base}\n\n${t}`), action.op || action.id);
      } else {
        out = await runProse(`${action.prompt}\n\n${content}`, setContent, action.op || action.id);
      }
    } catch (e) { setError(e.message || "处理失败了,请再试一次"); }
    setLoading(null);
    return out;
  };

  const genTitles = async () => {
    if (!content.trim() && !topic.trim()) return;
    setError(""); setLoading("titles");
    try {
      const src = content.trim() || `主题:${topic}`;
      const raw = await runJson("title",
        `请为下面的内容想5个适合${platform.name}的标题,要有点击欲但不做标题党。只返回JSON数组,格式:["标题1","标题2","标题3","标题4","标题5"],不要markdown代码块。\n\n${src}`,
        baseHint("title"));
      const clean = raw.replace(/```json|```/g, "").trim();
      const arr = JSON.parse(clean);
      if (Array.isArray(arr)) setTitles(arr.slice(0, 5));
    } catch { setError("标题生成失败,请再试一次"); }
    setLoading(null);
  };

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(docTitle.trim() ? `${docTitle.trim()}\n\n${content}` : content);
      setCopied(true); setTimeout(() => setCopied(false), 1600);
    } catch { /* 剪贴板不可用时静默 */ }
  };

  // ---- 发布前检查:AI 按当前平台查违禁词风险/错别字/存疑表述,输出结构化报告 ----
  const checkStale = !!checkReport && content !== checkedContent; // 正文改过,报告已过期

  const runCheck = async () => {
    if (!content.trim()) return;
    setError(""); setLoading("check");
    const snapshot = content;
    try {
      const raw = await runJson("check",
        `请检查下面这篇准备发布到「${platform.name}」的内容,找出:\n` +
        `1. 违禁词、广告法极限词、可能触发平台限流或审核风险的表述(type:"risk")\n` +
        `2. 错别字、病句、标点误用(type:"typo")\n` +
        `3. 表述不当或事实存疑、发布前需要核实的点(type:"fact")\n` +
        `只返回JSON,不要markdown代码块,格式:\n` +
        `{"score":0到100的发布安全分,"summary":"一句话总评","issues":[{"type":"risk|typo|fact","severity":"high|mid|low",` +
        `"excerpt":"原文中的确切片段(必须与原文逐字一致,便于定位替换)","reason":"问题说明","suggestion":"可直接替换excerpt的修改文本,无法给出时留空"}]}\n` +
        `没有问题就返回 {"score":95以上,"summary":"...","issues":[]}。\n\n${snapshot}`,
        "你是资深新媒体内容安全与文字编辑专家,熟悉广告法与各平台社区规范,判断精准、不夸大风险。"
        + skillsFor("check") + refsFor("check"));
      const data = JSON.parse(raw.replace(/```json|```/g, "").trim());
      if (!data || !Array.isArray(data.issues)) throw new Error("返回格式异常");
      setCheckReport({
        score: Math.max(0, Math.min(100, Number(data.score) || 0)),
        summary: String(data.summary || "").slice(0, 120),
        issues: data.issues.slice(0, 20).map(i => ({
          type: ["risk", "typo", "fact"].includes(i.type) ? i.type : "fact",
          severity: ["high", "mid", "low"].includes(i.severity) ? i.severity : "mid",
          excerpt: String(i.excerpt || ""),
          reason: String(i.reason || ""),
          suggestion: String(i.suggestion || ""),
        })),
      });
      setCheckedContent(snapshot);
    } catch (e) { setError(`检查失败:${(e.message || "请重试").slice(0, 80)}`); }
    setLoading(null);
  };

  // 一键应用某条建议:在正文中替换首个匹配片段(可撤销);原文已被改动则标记定位失败
  const applyIssue = (idx) => {
    const issue = checkReport?.issues[idx];
    if (!issue || !issue.suggestion) return;
    if (!issue.excerpt || !content.includes(issue.excerpt)) {
      setCheckReport(r => ({ ...r, issues: r.issues.map((x, i) => i === idx ? { ...x, lost: true } : x) }));
      return;
    }
    pushHistory();
    const next = content.replace(issue.excerpt, issue.suggestion);
    setContent(next);
    setCheckedContent(next); // 应用建议是报告自身的修复,不让报告因此过期
    setCheckReport(r => ({ ...r, issues: r.issues.map((x, i) => i === idx ? { ...x, applied: true } : x) }));
  };

  const dismissIssue = (idx) => {
    setCheckReport(r => ({ ...r, issues: r.issues.map((x, i) => i === idx ? { ...x, dismissed: true } : x) }));
  };

  // ---- 图文生成:动作 ----
  const itImportDraft = () => {
    if (!content.trim() && !docTitle.trim()) return;
    setItSource(docTitle.trim() ? `${docTitle.trim()}\n\n${content}` : content);
    setItError("");
  };

  const itSplit = async (useAI) => {
    if (!itSource.trim()) { setItError("先粘贴文章,或从写作模块带入"); return; }
    setItError(""); setItNote(""); setItTitles([]); setItCaption("");
    if (!useAI) {
      setItCards(localSplitCards(itSource, docTitle.trim() || undefined));
      setItNote("本地快速拆分(未用模型)");
      return;
    }
    setItLoading(true);
    try {
      const raw = await runJson("cards",
        `请把下面的文章重组成适合小红书图文笔记的卡片结构。只返回JSON,不要markdown代码块,格式:\n` +
        `{"cover":{"title":"12-20字有点击欲的主标题","tag":"4-8字亮点标签"},"pages":[{"heading":"每页小标题,8字内","points":["每页2-4条要点,每条20-40字,口语化"]}]}\n` +
        `pages 共 3-6 页,要点要提炼观点而不是照抄原文。\n\n文章:\n${itSource.trim()}`,
        "你是资深小红书图文笔记编辑,擅长把长文提炼成分页卡片。" + skillsFor("cards", "xhs") + refsFor("cards"),
        "xhs", "图文拆卡");
      const cards = normalizeCards(JSON.parse(raw.replace(/```json|```/g, "").trim()));
      if (!cards) throw new Error("bad shape");
      setItCards(cards); setItNote("AI 拆分完成,可切换主题与画幅");
    } catch (e) {
      // 模型不可用/返回不合法 → 本地兜底,保证功能可用
      setItCards(localSplitCards(itSource, docTitle.trim() || undefined));
      setItNote(`模型拆分未成功(${(e.message || "格式异常").slice(0, 40)}),已用本地拆分兜底`);
    }
    setItLoading(false);
  };

  // 主题直出:不需要现成文章,输入主题直接生成整组卡片;可选粘贴参考爆款只仿其结构
  const itGenerate = async () => {
    if (!itTopic.trim()) { setItError("先写下主题,比如「租房避坑指南」"); return; }
    setItError(""); setItNote(""); setItTitles([]); setItCaption("");
    setItLoading(true);
    try {
      await autoRefs(itTopic.trim());
      const ref = itRefNote.trim()
        ? `\n\n参考下面这篇爆款笔记的结构、节奏与表达风格(只学结构和写法,不要抄它的内容):\n${itRefNote.trim().slice(0, 2000)}`
        : "";
      const raw = await runJson("cards",
        `请围绕主题「${itTopic.trim()}」创作一组小红书图文笔记卡片,内容要具体、有信息量、口语化有网感。` +
        `只返回JSON,不要markdown代码块,格式:\n` +
        `{"cover":{"title":"12-20字有点击欲的主标题","tag":"4-8字亮点标签"},"pages":[{"heading":"每页小标题,8字内","points":["每页2-4条要点,每条20-40字"]}]}\n` +
        `pages 共 3-6 页。${ref}`,
        "你是资深小红书图文笔记创作者,擅长把一个主题拆解成有传播力的分页卡片。" + skillsFor("cards", "xhs") + refsFor("cards"),
        "xhs", "图文主题直出");
      const cards = normalizeCards(JSON.parse(raw.replace(/```json|```/g, "").trim()));
      if (!cards) throw new Error("返回格式异常");
      setItCards(cards);
      setItNote(itRefNote.trim() ? "已按参考笔记的结构生成,可换标题、配发布文案" : "AI 生成完成,可换标题、配发布文案");
    } catch (e) {
      setItError(`生成失败:${(e.message || "请重试").slice(0, 80)}`);
    }
    setItLoading(false);
  };

  // 参考爆款笔记也可以只给一个链接:抓回正文填进输入框(用户还能再手改),
  // 省掉"打开浏览器 → 全选 → 复制 → 回来粘贴"这四步
  const itFetchRefNote = async (u) => {
    const link = String(u || "").trim();
    if (!link) return false;
    setItError(""); setItRefLoading(true);
    const t = traceStart("read", "抓取参考笔记", { url: link });
    try {
      const page = await readUrl(link, searchCfg());
      traceEnd(t, { detail: { title: page.title, chars: page.text.length, text: page.text } });
      setItRefNote(page.text.slice(0, 2000));
      return true;
    } catch (e) {
      traceEnd(t, { error: e.message });
      setItError(`抓取失败:${(e.message || "请重试").slice(0, 80)}`);
      return false;
    } finally { setItRefLoading(false); }
  };

  // 封面标题打磨:基于已生成的卡片出 5 个候选,点击替换
  const itGenTitles = async () => {
    if (!itCards) return;
    setItError(""); setItTitlesLoading(true);
    try {
      const src = `${itCards.cover.title}\n${itCards.pages.map(p => `${p.heading}:${p.points.join(";")}`).join("\n")}`;
      const raw = await runJson("title",
        `根据下面这组图文卡片的内容,给封面想5个更有点击欲的小红书标题(12-20字,可带1个emoji,不做标题党)。` +
        `只返回JSON数组:["标题1","标题2","标题3","标题4","标题5"],不要markdown代码块。\n\n${src}`,
        "你是小红书爆款标题专家。" + skillsFor("title", "xhs"), "xhs", "封面标题");
      const arr = JSON.parse(raw.replace(/```json|```/g, "").trim());
      if (!Array.isArray(arr) || arr.length === 0) throw new Error("返回格式异常");
      setItTitles(arr.map(x => String(x).trim().slice(0, 30)).filter(Boolean).slice(0, 5));
    } catch (e) { setItError(`标题生成失败:${(e.message || "请重试").slice(0, 80)}`); }
    setItTitlesLoading(false);
  };

  const itPickTitle = (t) => {
    if (!itCards) return;
    setItCards({ ...itCards, cover: { ...itCards.cover, title: t } });
  };

  // 发布文案:发图时配的 caption + 话题标签
  const itGenCaption = async () => {
    if (!itCards) return;
    setItError(""); setItCaptionLoading(true);
    try {
      const src = `${itCards.cover.title}\n${itCards.pages.map(p => `${p.heading}:${p.points.join(";")}`).join("\n")}`;
      const text = await runJson("caption",
        `根据下面这组图文卡片,写一段发布时配的小红书正文文案:100-180字,口语化有网感,分2-3小段,` +
        `适度用emoji,结尾另起一行给4-6个话题标签(#开头,空格分隔)。直接输出文案本身。\n\n${src}`,
        "你是小红书运营,擅长写高互动的笔记配文。" + skillsFor("caption", "xhs") + refsFor("caption"), "xhs");
      setItCaption(text);
    } catch (e) { setItError(`文案生成失败:${(e.message || "请重试").slice(0, 80)}`); }
    setItCaptionLoading(false);
  };

  const itCopyCaption = async () => {
    if (!itCaption) return;
    try {
      await navigator.clipboard.writeText(itCaption);
      setItCaptionCopied(true); setTimeout(() => setItCaptionCopied(false), 1600);
    } catch { /* 剪贴板不可用时静默 */ }
  };

  const itDrawOpts = (pageIndex) => ({
    theme: itTheme, ratio: itRatio, scale: itScale,
    signature: itSignature.trim(), pageIndex, pageTotal: itCards?.pages.length || 0,
  });

  const itDownload = (canvas, name) => new Promise(resolve => {
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name; a.click();
      setTimeout(() => { URL.revokeObjectURL(url); resolve(); }, 120);
    }, "image/png");
  });

  const itExportOne = (kind, i) => {
    if (!itCards) return;
    const canvas = kind === "cover"
      ? drawCardCanvas(itCards, "cover", itDrawOpts(0))
      : drawCardCanvas(itCards.pages[i], "page", itDrawOpts(i));
    itDownload(canvas, kind === "cover" ? "落笔图文_封面.png" : `落笔图文_${String(i + 1).padStart(2, "0")}.png`);
  };

  const itExportAll = async () => {
    if (!itCards) return;
    await itDownload(drawCardCanvas(itCards, "cover", itDrawOpts(0)), "落笔图文_封面.png");
    for (let i = 0; i < itCards.pages.length; i++) {
      await itDownload(drawCardCanvas(itCards.pages[i], "page", itDrawOpts(i)), `落笔图文_${String(i + 1).padStart(2, "0")}.png`);
    }
  };

  const itCopyText = async () => {
    if (!itCards) return;
    const text = [
      `${itCards.cover.title}【${itCards.cover.tag}】`,
      ...itCards.pages.map(p => `${p.heading}\n${p.points.map(x => `· ${x}`).join("\n")}`),
    ].join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setItCopied(true); setTimeout(() => setItCopied(false), 1600);
    } catch { /* 剪贴板不可用时静默 */ }
  };

  const value = {
    // 写作
    platform, setPlatform, tone, setTone, topic, setTopic, content, setContent,
    docTitle, setDocTitle, titles, setTitles, loading, error, copied,
    generate, runAction, genTitles, copyAll,
    // 撤销 / 发布前检查
    canUndo: history.length > 0, undoLast,
    checkReport, checkStale, runCheck, applyIssue, dismissIssue,
    // 过程留痕
    trace, activity, clearTrace,
    // 选题灵感
    inspo, inspoLoading, inspoError, inspoField, genTopicIdeas, pickTopicIdea, clearInspo,
    // 联网:配置 / 资料
    searchProvider, setSearchProvider, searchKey, setSearchKey,
    searchCount, setSearchCount, searchFreshness, setSearchFreshness,
    readerKey, setReaderKey, webEnabled, setWebEnabled,
    webReady, webOn, webSummary, searchCfg,
    refs, refPlan, pickedRefs, refsLoading, refsError, refsQuery, setRefsError,
    searchRefs, addRefByUrl, fetchRefText, toggleRef, removeRef, clearRefs, insertSources,
    // 流式输出 / 大纲先行
    streamEnabled, setStreamEnabled,
    outline, genOutline, writeFromOutline, clearOutline,
    updateOutlineItem, removeOutlineItem, addOutlineItem, moveOutlineItem,
    // 文章库
    articles, currentArticleId, savedFlash,
    saveArticle, openArticle, deleteArticle, exportMd, exportCurrentMd,
    // 文章存储位置
    articlesDir, storageError, storageBusy, migratePending, migrateNote,
    pickArticlesDir, confirmMigrate, resetArticlesDir, openArticlesDir, rescanArticles,
    // 模型 / API
    modelId, setModelId, customModel, setCustomModel,
    apiMode, setApiMode, apiFormat, setApiFormat, apiHost, setApiHost,
    apiKey, setApiKey, customApiModel, setCustomApiModel,
    customModels, addCustomModel, removeCustomModel,
    savedProviders, saveProvider, removeProvider, applyProvider,
    activeModel, modelSummary,
    // 技能
    skills, enabledSkills, skillSummary, skillPlan, importSkills, toggleSkill, removeSkill,
    addSkill, updateSkill, resetBuiltinSkill, restoreBuiltinSkills, exportSkillMd,
    hasDeletedBuiltins: hasDeletedBuiltins(skills), skillsFor, skillAction, selectSkills,
    // 图文
    itSource, setItSource, itSignature, setItSignature,
    itThemeId, setItThemeId, itRatioId, setItRatioId, itFontId, setItFontId,
    itTheme, itRatio, itScale, itCards, itLoading, itError, itNote, itCopied,
    itImportDraft, itSplit, itExportOne, itExportAll, itCopyText,
    itMode, setItMode, itTopic, setItTopic, itRefNote, setItRefNote,
    itRefLoading, itFetchRefNote,
    itGenerate, itTitles, itTitlesLoading, itGenTitles, itPickTitle,
    itCaption, itCaptionLoading, itCaptionCopied, itGenCaption, itCopyCaption,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export const useApp = () => useContext(AppContext);
