import { createContext, useContext, useEffect, useRef, useState } from "react";
import { MODELS, callAI, callAIStream } from "./lib/api";
import { PLATFORMS, TONES } from "./lib/presets";
import { BUILTIN_SKILLS, parseSkillFile } from "./lib/skills";
import { IT_THEMES, IT_RATIOS, IT_FONT_SIZES, localSplitCards, normalizeCards, drawCardCanvas } from "./lib/cards";
import { loadSettings, saveSettings, loadArticles, saveArticles } from "./lib/storage";

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

  // ---- 写作技能 ----
  const [skills, setSkills] = useState(BUILTIN_SKILLS);

  // ---- 文章库(已保存的文章,持久化) ----
  const [articles, setArticles] = useState([]);
  const [currentArticleId, setCurrentArticleId] = useState(null); // 当前编辑器里对应的文章,再次保存时覆盖而不是新建
  const [savedFlash, setSavedFlash] = useState(false);

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
  const [itTitles, setItTitles] = useState([]);        // 封面标题候选
  const [itTitlesLoading, setItTitlesLoading] = useState(false);
  const [itCaption, setItCaption] = useState("");      // 发布文案(caption + 话题标签)
  const [itCaptionLoading, setItCaptionLoading] = useState(false);
  const [itCaptionCopied, setItCaptionCopied] = useState(false);

  // ---- 设置持久化:启动时水合,变更后防抖保存 ----
  const [hydrated, setHydrated] = useState(false);
  const saveTimer = useRef(null);

  useEffect(() => {
    loadSettings().then(s => {
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
        if (MODELS.some(m => m.id === s.modelId)) setModelId(s.modelId);
        if (typeof s.customModel === "string") setCustomModel(s.customModel);
        if (typeof s.itSignature === "string") setItSignature(s.itSignature);
        if (IT_THEMES.some(t => t.id === s.itThemeId)) setItThemeId(s.itThemeId);
        if (IT_RATIOS.some(r => r.id === s.itRatioId)) setItRatioId(s.itRatioId);
        if (IT_FONT_SIZES.some(f => f.id === s.itFontId)) setItFontId(s.itFontId);
      }
      setHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (!hydrated) return; // 水合完成前不回写,避免默认值覆盖已存设置
    clearTimeout(saveTimer.current);
    const snapshot = { apiMode, apiFormat, apiHost, apiKey, customApiModel, customModels, savedProviders,
      modelId, customModel, streamEnabled, itSignature, itThemeId, itRatioId, itFontId };
    saveTimer.current = setTimeout(() => saveSettings(snapshot), 300);
    return () => clearTimeout(saveTimer.current);
  }, [hydrated, apiMode, apiFormat, apiHost, apiKey, customApiModel, customModels, savedProviders,
    modelId, customModel, streamEnabled, itSignature, itThemeId, itRatioId, itFontId]);

  // ---- 文章库持久化:启动时水合,变更后防抖保存 ----
  const [articlesReady, setArticlesReady] = useState(false);
  const articlesTimer = useRef(null);

  useEffect(() => {
    loadArticles().then(list => {
      if (Array.isArray(list)) setArticles(list.filter(a => a && typeof a.id === "string"));
      setArticlesReady(true);
    });
  }, []);

  useEffect(() => {
    if (!articlesReady) return;
    clearTimeout(articlesTimer.current);
    articlesTimer.current = setTimeout(() => saveArticles(articles), 300);
    return () => clearTimeout(articlesTimer.current);
  }, [articlesReady, articles]);

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
  const skillSummary = enabledSkills.length > 0 ? `${enabledSkills.length} 项生效中` : "未启用";

  const baseHint = () => {
    let hint = `你是一位资深自媒体写作者。写作平台:${platform.prompt} 语气风格:${tone.name}(${tone.desc})。`;
    if (enabledSkills.length > 0) {
      hint += "\n\n以下是必须严格遵循的写作技能规范:\n" +
        enabledSkills.map(s => `【技能:${s.name}】\n${s.content.slice(0, 4000)}`).join("\n\n");
    }
    return hint;
  };

  // ---- 写作:动作 ----
  const importSkills = (fileList) => {
    const files = Array.from(fileList || []);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || "").trim();
        if (!text) { setError(`「${file.name}」是空文件,已跳过`); return; }
        setSkills(prev => [...prev, parseSkillFile(file.name, text)]);
      };
      reader.onerror = () => setError(`读取「${file.name}」失败,请重试`);
      reader.readAsText(file);
    });
  };

  const toggleSkill = (id) => setSkills(prev => prev.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s));
  const removeSkill = (id) => setSkills(prev => prev.filter(s => s.id !== id));

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
    const now = Date.now();
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
  const runProse = async (prompt, apply) => {
    if (streamEnabled) {
      const text = await callAIStream(prompt, baseHint(), apiConfig(), apply);
      apply(text); // 收尾用 trim 过的最终结果覆盖一次
      return text;
    }
    const text = await callAI(prompt, baseHint(), apiConfig());
    apply(text);
    return text;
  };

  const generate = async () => {
    if (!topic.trim()) { setError("先写下你想聊的主题"); return; }
    if (content.trim() || docTitle.trim()) pushHistory(); // 覆盖已有内容前留快照,可撤销
    setError(""); setLoading("gen"); setTitles([]); setDocTitle("");
    setCurrentArticleId(null); // 新生成的是新文章,保存时不覆盖旧文
    try {
      await runProse(`请围绕这个主题创作一篇内容:「${topic.trim()}」`, setContent);
    } catch (e) { setError(e.message || "生成失败了,请再试一次"); }
    setLoading(null);
  };

  // ---- 大纲先行:先出结构再成文,长文更有逻辑推进 ----
  const genOutline = async () => {
    if (!topic.trim()) { setError("先写下你想聊的主题"); return; }
    setError(""); setLoading("outline");
    try {
      const raw = await callAI(
        `请为主题「${topic.trim()}」列一份适合${platform.name}的写作大纲,4-6个小节,循序渐进、有逻辑推进,不要写正文。` +
        `只返回JSON数组,不要markdown代码块,格式:[{"heading":"小节标题,12字内","note":"这一节要写什么,25-40字"}]`,
        baseHint(), apiConfig()
      );
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
  const runAction = async (action, sel) => {
    if (!content.trim()) return;
    const selValid = action.mode !== "append" && sel &&
      Number.isInteger(sel.start) && Number.isInteger(sel.end) &&
      sel.start >= 0 && sel.start < sel.end && sel.end <= content.length;
    setError(""); setLoading(action.id);
    pushHistory(); // 流式会边写边改正文,快照必须先留;中途失败也能撤销回改前状态
    try {
      if (selValid) {
        // 选区局部改写:带上下文提示衔接,结果只替换选中段
        const before = content.slice(0, sel.start);
        const selText = content.slice(sel.start, sel.end);
        const after = content.slice(sel.end);
        const prompt = `${action.prompt}\n\n${selText}\n\n` +
          `(注意:这是文章中的一个片段,上文结尾是「…${before.slice(-120)}」,下文开头是「${after.slice(0, 120)}…」,` +
          `改写结果必须与上下文自然衔接,只输出改写后的片段本身)`;
        await runProse(prompt, t => setContent(before + t + after));
      } else if (action.mode === "append") {
        // 续写:结果追加到正文末尾
        const base = content.trim();
        await runProse(`${action.prompt}\n\n${content}`, t => setContent(`${base}\n\n${t}`));
      } else {
        await runProse(`${action.prompt}\n\n${content}`, setContent);
      }
    } catch (e) { setError(e.message || "处理失败了,请再试一次"); }
    setLoading(null);
  };

  const genTitles = async () => {
    if (!content.trim() && !topic.trim()) return;
    setError(""); setLoading("titles");
    try {
      const src = content.trim() || `主题:${topic}`;
      const raw = await callAI(
        `请为下面的内容想5个适合${platform.name}的标题,要有点击欲但不做标题党。只返回JSON数组,格式:["标题1","标题2","标题3","标题4","标题5"],不要markdown代码块。\n\n${src}`,
        baseHint(), apiConfig()
      );
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
      const raw = await callAI(
        `请检查下面这篇准备发布到「${platform.name}」的内容,找出:\n` +
        `1. 违禁词、广告法极限词、可能触发平台限流或审核风险的表述(type:"risk")\n` +
        `2. 错别字、病句、标点误用(type:"typo")\n` +
        `3. 表述不当或事实存疑、发布前需要核实的点(type:"fact")\n` +
        `只返回JSON,不要markdown代码块,格式:\n` +
        `{"score":0到100的发布安全分,"summary":"一句话总评","issues":[{"type":"risk|typo|fact","severity":"high|mid|low",` +
        `"excerpt":"原文中的确切片段(必须与原文逐字一致,便于定位替换)","reason":"问题说明","suggestion":"可直接替换excerpt的修改文本,无法给出时留空"}]}\n` +
        `没有问题就返回 {"score":95以上,"summary":"...","issues":[]}。\n\n${snapshot}`,
        "你是资深新媒体内容安全与文字编辑专家,熟悉广告法与各平台社区规范,判断精准、不夸大风险。",
        apiConfig()
      );
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
      const raw = await callAI(
        `请把下面的文章重组成适合小红书图文笔记的卡片结构。只返回JSON,不要markdown代码块,格式:\n` +
        `{"cover":{"title":"12-20字有点击欲的主标题","tag":"4-8字亮点标签"},"pages":[{"heading":"每页小标题,8字内","points":["每页2-4条要点,每条20-40字,口语化"]}]}\n` +
        `pages 共 3-6 页,要点要提炼观点而不是照抄原文。\n\n文章:\n${itSource.trim()}`,
        "你是资深小红书图文笔记编辑,擅长把长文提炼成分页卡片。", apiConfig()
      );
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
      const ref = itRefNote.trim()
        ? `\n\n参考下面这篇爆款笔记的结构、节奏与表达风格(只学结构和写法,不要抄它的内容):\n${itRefNote.trim().slice(0, 2000)}`
        : "";
      const raw = await callAI(
        `请围绕主题「${itTopic.trim()}」创作一组小红书图文笔记卡片,内容要具体、有信息量、口语化有网感。` +
        `只返回JSON,不要markdown代码块,格式:\n` +
        `{"cover":{"title":"12-20字有点击欲的主标题","tag":"4-8字亮点标签"},"pages":[{"heading":"每页小标题,8字内","points":["每页2-4条要点,每条20-40字"]}]}\n` +
        `pages 共 3-6 页。${ref}`,
        "你是资深小红书图文笔记创作者,擅长把一个主题拆解成有传播力的分页卡片。", apiConfig()
      );
      const cards = normalizeCards(JSON.parse(raw.replace(/```json|```/g, "").trim()));
      if (!cards) throw new Error("返回格式异常");
      setItCards(cards);
      setItNote(itRefNote.trim() ? "已按参考笔记的结构生成,可换标题、配发布文案" : "AI 生成完成,可换标题、配发布文案");
    } catch (e) {
      setItError(`生成失败:${(e.message || "请重试").slice(0, 80)}`);
    }
    setItLoading(false);
  };

  // 封面标题打磨:基于已生成的卡片出 5 个候选,点击替换
  const itGenTitles = async () => {
    if (!itCards) return;
    setItError(""); setItTitlesLoading(true);
    try {
      const src = `${itCards.cover.title}\n${itCards.pages.map(p => `${p.heading}:${p.points.join(";")}`).join("\n")}`;
      const raw = await callAI(
        `根据下面这组图文卡片的内容,给封面想5个更有点击欲的小红书标题(12-20字,可带1个emoji,不做标题党)。` +
        `只返回JSON数组:["标题1","标题2","标题3","标题4","标题5"],不要markdown代码块。\n\n${src}`,
        "你是小红书爆款标题专家。", apiConfig()
      );
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
      const text = await callAI(
        `根据下面这组图文卡片,写一段发布时配的小红书正文文案:100-180字,口语化有网感,分2-3小段,` +
        `适度用emoji,结尾另起一行给4-6个话题标签(#开头,空格分隔)。直接输出文案本身。\n\n${src}`,
        "你是小红书运营,擅长写高互动的笔记配文。", apiConfig()
      );
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
    // 流式输出 / 大纲先行
    streamEnabled, setStreamEnabled,
    outline, genOutline, writeFromOutline, clearOutline,
    updateOutlineItem, removeOutlineItem, addOutlineItem, moveOutlineItem,
    // 文章库
    articles, currentArticleId, savedFlash,
    saveArticle, openArticle, deleteArticle, exportMd, exportCurrentMd,
    // 模型 / API
    modelId, setModelId, customModel, setCustomModel,
    apiMode, setApiMode, apiFormat, setApiFormat, apiHost, setApiHost,
    apiKey, setApiKey, customApiModel, setCustomApiModel,
    customModels, addCustomModel, removeCustomModel,
    savedProviders, saveProvider, removeProvider, applyProvider,
    activeModel, modelSummary,
    // 技能
    skills, enabledSkills, skillSummary, importSkills, toggleSkill, removeSkill,
    // 图文
    itSource, setItSource, itSignature, setItSignature,
    itThemeId, setItThemeId, itRatioId, setItRatioId, itFontId, setItFontId,
    itTheme, itRatio, itScale, itCards, itLoading, itError, itNote, itCopied,
    itImportDraft, itSplit, itExportOne, itExportAll, itCopyText,
    itMode, setItMode, itTopic, setItTopic, itRefNote, setItRefNote,
    itGenerate, itTitles, itTitlesLoading, itGenTitles, itPickTitle,
    itCaption, itCaptionLoading, itCaptionCopied, itGenCaption, itCopyCaption,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export const useApp = () => useContext(AppContext);
