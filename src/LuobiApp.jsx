import { useState, useRef } from "react";

// ============ 设计系统:宣纸白 + 墨色 + 印泥红(仅用于主操作) ============
const T = {
  paper: "#FAF9F5",
  paperDeep: "#F2F0E9",
  ink: "#23262D",
  inkSoft: "#5B5F68",
  inkFaint: "#9A9DA5",
  line: "#E3E1D8",
  seal: "#B4342A",
  sealDark: "#93281F",
  indigo: "#33529C",
  indigoBg: "#EEF1F8",
  serif: '"Songti SC","Noto Serif SC","SimSun",serif',
  sans: '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif',
};

// ============ 平台与语气配置 ============
const PLATFORMS = [
  { id: "gzh", name: "公众号", tag: "深度长文", hint: "结构完整、有观点、可读性强的文章,800-1200字",
    prompt: "微信公众号文章:有吸引力的开头钩子、清晰的小标题分段、结尾引导互动。字数800-1200字,深度与可读性并重。" },
  { id: "xhs", name: "小红书", tag: "种草笔记", hint: "emoji + 短段落,亲切有网感,300-500字",
    prompt: "小红书笔记:适度使用emoji、短段落、口语化有网感,像朋友分享。开头抓眼球,结尾带3-5个话题标签。字数300-500字。" },
  { id: "zhihu", name: "知乎", tag: "专业回答", hint: "逻辑严密、先给结论、举例论证",
    prompt: "知乎回答:先亮明结论,再分层论证,引用事实或案例支撑,语气理性专业但不枯燥。字数600-1000字。" },
  { id: "weibo", name: "微博", tag: "热点短评", hint: "140-300字,观点鲜明,带话题",
    prompt: "微博短文:140-300字,观点鲜明、语言犀利有记忆点,结尾带1-2个#话题#。" },
];

const TONES = [
  { id: "pro", name: "专业理性", desc: "克制、有据、可信" },
  { id: "warm", name: "温暖治愈", desc: "共情、柔软、有温度" },
  { id: "sharp", name: "犀利吐槽", desc: "直接、幽默、有态度" },
  { id: "story", name: "故事叙事", desc: "场景、细节、代入感" },
];

const QUICK_ACTIONS = [
  { id: "rewrite", name: "换种写法", prompt: "请把下面这篇内容换一种写法重写,保持主题和平台风格不变,但用不同的切入角度和表达方式:" },
  { id: "expand", name: "扩写丰富", prompt: "请扩写下面这篇内容,补充更多细节、例子或论据,让它更充实(篇幅增加约50%):" },
  { id: "shorten", name: "精简压缩", prompt: "请把下面这篇内容压缩到原来的60%左右,保留核心观点和最有力的表达,删掉冗余:" },
  { id: "polish", name: "润色提升", prompt: "请润色下面这篇内容:优化用词、让句子更有节奏感、强化开头和结尾,不改变结构和观点:" },
];

// ============ 模型配置 ============
const MODELS = [
  { id: "claude-sonnet-4-6", name: "Sonnet 4.6", desc: "均衡首选 · 快且稳" },
  { id: "claude-opus-4-8", name: "Opus 4.8", desc: "深度长文 · 更强表达" },
  { id: "claude-haiku-4-5-20251001", name: "Haiku 4.5", desc: "极速出稿 · 轻量任务" },
  { id: "__custom__", name: "自定义", desc: "手动输入模型名称" },
];

// ============ 写作技能(Skills) ============
// 技能 = 一份写作规范/方法论文本,启用后会注入到每次生成的提示词中
const BUILTIN_SKILLS = [
  {
    id: "sk-hook", name: "黄金开头三板斧", builtin: true, enabled: false,
    content: "开头必须在前两句抓住读者,任选其一:①反常识观点(先说一个和大众认知相反的结论)②具体场景(用一个有画面感的瞬间把读者拉进来)③直击痛点提问(问出读者心里正在想的那个问题)。禁止用「随着…的发展」「在当今社会」这类空泛开头。",
  },
  {
    id: "sk-title", name: "爆款标题公式", builtin: true, enabled: false,
    content: "标题优先使用以下结构:数字盘点式(如「5个方法」)、对比反差式(「月薪5千 vs 月薪5万」)、悬念留白式(结尾留半句)、身份代入式(点名目标人群)。标题控制在12-24字,至少包含一个具体数字或具体人群词。",
  },
];

// 解析导入的技能文件:支持带 YAML frontmatter 的 SKILL.md(name/description 字段),也支持纯文本
function parseSkillFile(filename, text) {
  let name = filename.replace(/\.(md|txt|markdown)$/i, "");
  let body = text.trim();
  const fm = body.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (fm) {
    const nameMatch = fm[1].match(/^name:\s*(.+)$/m);
    if (nameMatch) name = nameMatch[1].trim().replace(/^["']|["']$/g, "");
    body = body.slice(fm[0].length).trim();
  }
  return { id: `sk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, content: body, builtin: false, enabled: true };
}

// ============ Claude API ============
// ============ API 调用层:内置通道 / 自定义 Host(Claude 格式 或 OpenAI 兼容格式) ============
function buildEndpoint(host, path) {
  const h = host.trim().replace(/\/+$/, "");
  const tail = path.replace(/^\/v1/, ""); // "/chat/completions" 或 "/messages"
  // 用户填的地址如果已经是完整端点,直接使用
  if (h.endsWith(path) || h.endsWith(tail)) return h;
  // 根地址自带版本号的写法:/v1(DeepSeek 等)、/api/paas/v4(智谱)等,只补端点尾部
  if (/\/v\d+$/i.test(h)) return h + tail;
  return h + path;
}

// 按运行环境选择请求通道:
// 1. Tauri 桌面端 → 原生 HTTP 插件发请求,天然无 CORS 限制
// 2. 浏览器本地开发 → 走 Vite 的 /llm-proxy 中间件转发(见 vite.config.js),目标地址放 x-proxy-target 头
// 3. 浏览器生产构建 → 直连(需目标服务允许跨域)
const isTauri = typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

async function proxyFetch(url, options) {
  if (isTauri) {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    return tauriFetch(url, options);
  }
  if (import.meta.env.DEV) {
    return fetch("/llm-proxy", { ...options, headers: { ...options.headers, "x-proxy-target": url } });
  }
  return fetch(url, options);
}

async function callAI(userPrompt, systemHint, api) {
  const userContent = `${userPrompt}\n\n直接输出正文,不要任何前言或解释。`;

  // ---- 内置通道:免配置,走平台自带的 Claude 接口 ----
  if (api.mode === "builtin") {
    const res = await proxyFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: api.model || "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [{ role: "user", content: `${systemHint}\n\n${userContent}` }],
      }),
    });
    const data = await res.json();
    if (data.type === "error" || !data.content) throw new Error(data.error?.message || "模型调用失败,请检查模型名称是否正确");
    return data.content.filter(b => b.type === "text").map(b => b.text).join("\n").trim();
  }

  // ---- 自定义接入:校验必填项 ----
  if (!api.host.trim()) throw new Error("请先填写 API Host 地址");
  if (!api.model.trim()) throw new Error("请先填写模型名称");

  const endpoint = buildEndpoint(api.host, api.format === "anthropic" ? "/v1/messages" : "/v1/chat/completions");

  let res;
  try {
    if (api.format === "anthropic") {
      // Claude 格式:POST {host}/v1/messages
      res = await proxyFetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
          ...(api.key.trim() ? { "x-api-key": api.key.trim() } : {}),
        },
        body: JSON.stringify({
          model: api.model.trim(),
          max_tokens: 2000,
          system: systemHint,
          messages: [{ role: "user", content: userContent }],
        }),
      });
    } else {
      // OpenAI 兼容格式:POST {host}/v1/chat/completions
      res = await proxyFetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(api.key.trim() ? { Authorization: `Bearer ${api.key.trim()}` } : {}),
        },
        body: JSON.stringify({
          model: api.model.trim(),
          max_tokens: 2000,
          messages: [
            { role: "system", content: systemHint },
            { role: "user", content: userContent },
          ],
        }),
      });
    }
  } catch {
    if (isTauri) throw new Error("无法连接到该 Host:请检查地址是否正确、网络是否可达");
    throw new Error(import.meta.env.DEV
      ? "无法连接到本地代理:请确认 npm run dev 开发服务器正常运行"
      : "无法连接到该 Host:请检查地址是否正确,以及服务端是否允许浏览器跨域(CORS)访问");
  }

  let data;
  try { data = await res.json(); } catch {
    if (res.status === 404) throw new Error(`目标服务返回 404:端点不存在,请检查 Host 填写是否正确(实际请求:${endpoint})`);
    if (res.status === 401 || res.status === 403) throw new Error(`鉴权失败(HTTP ${res.status}):请检查 API Key 是否正确`);
    throw new Error(`服务返回了非 JSON 内容(HTTP ${res.status}),请检查 Host 与格式选择`);
  }

  if (api.format === "anthropic") {
    if (data.type === "error" || !data.content) throw new Error(data.error?.message || `调用失败(HTTP ${res.status})`);
    const blocks = Array.isArray(data.content) ? data.content : [];
    return blocks.filter(b => b.type === "text").map(b => b.text).join("\n").trim();
  } else {
    if (data.error) throw new Error(data.error.message || `调用失败(HTTP ${res.status})`);
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new Error(`响应格式不符合 OpenAI 规范(HTTP ${res.status}),请确认格式选择是否正确`);
    return text.trim();
  }
}

// 可折叠的设置面板:收起时在标题旁显示当前状态摘要,减少左栏视觉负担
function Fold({ title, summary, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section>
      <button className="lb-fold" onClick={() => setOpen(o => !o)} aria-expanded={open}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: 0,
          background: "transparent", border: "none", cursor: "pointer", textAlign: "left",
          marginBottom: open ? 10 : 0 }}>
        <span style={{ fontSize: 12, color: T.inkFaint, letterSpacing: 2, fontFamily: T.sans }}>{title}</span>
        {!open && summary && (
          <span style={{ marginLeft: "auto", fontSize: 11, color: T.indigo, maxWidth: 170,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</span>
        )}
        <span aria-hidden style={{ marginLeft: open ? "auto" : 0, fontSize: 9, color: T.inkFaint,
          transform: open ? "rotate(90deg)" : "none", transition: "transform .15s ease" }}>▶</span>
      </button>
      {open && children}
    </section>
  );
}

export default function LuobiApp() {
  const [platform, setPlatform] = useState(PLATFORMS[0]);
  const [tone, setTone] = useState(TONES[0]);
  const [topic, setTopic] = useState("");
  const [content, setContent] = useState("");
  const [docTitle, setDocTitle] = useState(""); // 文章标题:独立于正文,居中加粗展示
  const [titles, setTitles] = useState([]);
  const [loading, setLoading] = useState(null); // null | 'gen' | actionId | 'titles'
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [modelId, setModelId] = useState(MODELS[0].id);
  const [customModel, setCustomModel] = useState("");
  const [apiMode, setApiMode] = useState("builtin"); // 'builtin' | 'custom'
  const [apiFormat, setApiFormat] = useState("anthropic"); // 'anthropic' | 'openai'
  const [apiHost, setApiHost] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [customApiModel, setCustomApiModel] = useState("");
  const [skills, setSkills] = useState(BUILTIN_SKILLS);
  const [modelMenuOpen, setModelMenuOpen] = useState(false); // 主题卡片里的模型下拉菜单
  const [apiModalOpen, setApiModalOpen] = useState(false);   // 自定义接入设置弹层
  const editorRef = useRef(null);
  const fileInputRef = useRef(null);

  // 当前实际生效的模型:自定义模式下取输入框的值(为空则回退默认)
  const activeModel = apiMode === "custom"
    ? customApiModel.trim()
    : (modelId === "__custom__" ? customModel.trim() || "claude-sonnet-4-6" : modelId);

  // 汇总当前 API 配置,传给调用层
  const apiConfig = () => ({ mode: apiMode, format: apiFormat, host: apiHost, key: apiKey, model: activeModel });

  const enabledSkills = skills.filter(s => s.enabled);

  // 折叠面板收起时显示的状态摘要
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

  const importSkills = (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
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
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const toggleSkill = (id) => setSkills(prev => prev.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s));
  const removeSkill = (id) => setSkills(prev => prev.filter(s => s.id !== id));

  const generate = async () => {
    if (!topic.trim()) { setError("先写下你想聊的主题"); return; }
    setError(""); setLoading("gen"); setTitles([]); setDocTitle("");
    try {
      const text = await callAI(`请围绕这个主题创作一篇内容:「${topic.trim()}」`, baseHint(), apiConfig());
      setContent(text);
    } catch (e) { setError(e.message || "生成失败了,请再试一次"); }
    setLoading(null);
  };

  const runAction = async (action) => {
    if (!content.trim()) return;
    setError(""); setLoading(action.id);
    try {
      const text = await callAI(`${action.prompt}\n\n${content}`, baseHint(), apiConfig());
      setContent(text);
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

  const wordCount = content.replace(/\s/g, "").length;
  const busy = loading !== null;

  return (
    <div style={{ height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column",
      background: T.paper, fontFamily: T.sans, color: T.ink }}>
      <style>{`
        html, body, #root { margin: 0; padding: 0; height: 100%; overflow: hidden; }
        @keyframes inkPulse { 0%,100%{opacity:.35} 50%{opacity:1} }
        .lb-loading span { animation: inkPulse 1.2s infinite; display:inline-block }
        .lb-loading span:nth-child(2){ animation-delay:.2s } .lb-loading span:nth-child(3){ animation-delay:.4s }
        .lb-chip { transition: all .15s ease; cursor: pointer; }
        .lb-chip:hover { border-color: ${T.indigo}; }
        .lb-chip:focus-visible, .lb-btn:focus-visible, .lb-seal:focus-visible, .lb-fold:focus-visible { outline: 2px solid ${T.indigo}; outline-offset: 2px; }
        .lb-fold:hover > span:first-child { color: ${T.ink}; }
        .lb-menu-item { transition: background .12s ease; }
        .lb-menu-item:hover { background: ${T.indigoBg} !important; }
        .lb-btn { transition: all .15s ease; cursor: pointer; }
        .lb-btn:hover:not(:disabled) { background: ${T.indigoBg}; border-color: ${T.indigo}; color: ${T.indigo}; }
        .lb-btn:disabled { opacity:.45; cursor: default; }
        .lb-seal { transition: transform .12s ease, background .15s ease; cursor: pointer; }
        .lb-seal:hover:not(:disabled) { background: ${T.sealDark}; }
        .lb-seal:active:not(:disabled) { transform: scale(.97); }
        .lb-seal:disabled { opacity:.5; cursor: default; }
        .lb-title-card { transition: all .15s ease; cursor: pointer; }
        .lb-title-card:hover { border-color: ${T.indigo}; background: ${T.indigoBg}; }
        textarea:focus, input:focus { outline: none; }
        .lb-doc-title::placeholder { font-family: ${T.sans}; font-size: 14px; font-weight: 400; letter-spacing: 0; color: ${T.inkFaint}; }
        @media (prefers-reduced-motion: reduce) { .lb-loading span { animation: none } }
      `}</style>

      {/* ===== 顶栏 ===== */}
      <header style={{ borderBottom: `1px solid ${T.line}`, background: T.paper, flexShrink: 0 }}>
        <div style={{ maxWidth: 1440, margin: "0 auto", padding: "14px 28px", display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 34, height: 34, background: T.seal, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: T.serif, fontSize: 17, fontWeight: 700, borderRadius: 4, letterSpacing: 1 }}>落</div>
          <div>
            <div style={{ fontFamily: T.serif, fontSize: 19, fontWeight: 700, letterSpacing: 2 }}>落笔</div>
            <div style={{ fontSize: 11, color: T.inkFaint, letterSpacing: 1 }}>为自媒体创作者而生的 AI 写作台</div>
          </div>
          <div style={{ marginLeft: "auto", fontSize: 12, color: T.inkFaint }}>
            {wordCount > 0 ? `正文 ${wordCount} 字` : "今日,写点什么?"}
          </div>
        </div>
      </header>

      <main style={{ flex: 1, minHeight: 0, width: "100%", maxWidth: 1440, margin: "0 auto",
        padding: "24px 28px 28px", boxSizing: "border-box", display: "grid",
        gridTemplateColumns: "320px 1fr", gap: 32 }}>

        {/* ===== 左栏:创作设置 ===== */}
        <aside style={{ display: "flex", flexDirection: "column", gap: 20, minHeight: 0,
          overflowY: "auto", paddingRight: 4 }}>
          <section>
            <div style={{ fontSize: 12, color: T.inkFaint, letterSpacing: 2, marginBottom: 10 }}>发布平台</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {PLATFORMS.map(p => (
                <button key={p.id} className="lb-chip" onClick={() => setPlatform(p)}
                  style={{ textAlign: "left", padding: "10px 12px", borderRadius: 6, background: platform.id === p.id ? T.indigoBg : "#fff",
                    border: `1px solid ${platform.id === p.id ? T.indigo : T.line}` }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: platform.id === p.id ? T.indigo : T.ink }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: T.inkFaint, marginTop: 2 }}>{p.tag}</div>
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: T.inkFaint, marginTop: 8, lineHeight: 1.6 }}>
              {platform.hint}
            </div>
          </section>

          <section>
            <div style={{ fontSize: 12, color: T.inkFaint, letterSpacing: 2, marginBottom: 10 }}>语气风格</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {TONES.map(t => (
                <button key={t.id} className="lb-chip" onClick={() => setTone(t)} title={t.desc}
                  style={{ textAlign: "left", padding: "10px 12px", borderRadius: 6,
                    background: tone.id === t.id ? T.indigoBg : "#fff", border: `1px solid ${tone.id === t.id ? T.indigo : T.line}` }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: tone.id === t.id ? T.indigo : T.ink }}>{t.name}</div>
                  <div style={{ fontSize: 11, color: T.inkFaint, marginTop: 2 }}>{t.desc}</div>
                </button>
              ))}
            </div>
          </section>

          {/* ===== 自定义接入设置弹层 ===== */}
          {apiModalOpen && (
            <div onClick={() => setApiModalOpen(false)}
              style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(35,38,45,.38)",
                display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
              <div onClick={e => e.stopPropagation()} role="dialog" aria-label="自定义接入设置"
                style={{ width: 440, maxWidth: "100%", maxHeight: "86vh", overflowY: "auto", background: T.paper,
                  borderRadius: 12, border: `1px solid ${T.line}`, boxShadow: "0 20px 60px rgba(35,38,45,.22)", padding: "20px 22px" }}>
                <div style={{ display: "flex", alignItems: "baseline", marginBottom: 16 }}>
                  <span style={{ fontFamily: T.serif, fontSize: 17, fontWeight: 700, letterSpacing: 1 }}>自定义接入</span>
                  <span style={{ marginLeft: 10, fontSize: 11, color: T.inkFaint }}>自有 Host / Key,可接中转与本地服务</span>
                  <button onClick={() => setApiModalOpen(false)} aria-label="关闭"
                    style={{ marginLeft: "auto", border: "none", background: "transparent", color: T.inkFaint,
                      cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "2px 4px" }}>×</button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {/* API 格式 */}
                <div>
                  <div style={{ fontSize: 11, color: T.inkFaint, marginBottom: 6 }}>API 格式</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {[{ id: "anthropic", name: "Claude 格式", path: "/v1/messages" }, { id: "openai", name: "OpenAI 兼容", path: "/v1/chat/completions" }].map(f => (
                      <button key={f.id} className="lb-chip" onClick={() => setApiFormat(f.id)}
                        style={{ textAlign: "left", padding: "8px 10px", borderRadius: 6,
                          background: apiFormat === f.id ? T.indigoBg : "#fff", border: `1px solid ${apiFormat === f.id ? T.indigo : T.line}` }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: apiFormat === f.id ? T.indigo : T.ink }}>{f.name}</div>
                        <div style={{ fontSize: 10, color: T.inkFaint, marginTop: 2, fontFamily: "monospace" }}>{f.path}</div>
                      </button>
                    ))}
                  </div>
                </div>
                {/* Host */}
                <div>
                  <div style={{ fontSize: 11, color: T.inkFaint, marginBottom: 6 }}>API Host</div>
                  <input value={apiHost} onChange={e => setApiHost(e.target.value)}
                    placeholder={apiFormat === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com"}
                    spellCheck={false}
                    style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 6,
                      border: `1px solid ${T.line}`, fontSize: 13, fontFamily: "monospace", color: T.ink, background: "#fff" }} />
                </div>
                {/* Key */}
                <div>
                  <div style={{ fontSize: 11, color: T.inkFaint, marginBottom: 6 }}>API Key(仅保存在本页内存,刷新即清除)</div>
                  <input value={apiKey} onChange={e => setApiKey(e.target.value)} type="password"
                    placeholder="sk-…(无需鉴权的服务可留空)"
                    autoComplete="off" spellCheck={false}
                    style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 6,
                      border: `1px solid ${T.line}`, fontSize: 13, fontFamily: "monospace", color: T.ink, background: "#fff" }} />
                </div>
                {/* Model */}
                <div>
                  <div style={{ fontSize: 11, color: T.inkFaint, marginBottom: 6 }}>模型名称</div>
                  <input value={customApiModel} onChange={e => setCustomApiModel(e.target.value)}
                    placeholder={apiFormat === "anthropic" ? "如 claude-sonnet-4-6" : "如 gpt-4o / deepseek-chat / qwen-max"}
                    spellCheck={false}
                    style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 6,
                      border: `1px solid ${T.line}`, fontSize: 13, fontFamily: "monospace", color: T.ink, background: "#fff" }} />
                </div>
                <div style={{ fontSize: 11, color: T.inkFaint, lineHeight: 1.7, padding: "8px 10px", background: T.paperDeep, borderRadius: 6 }}>
                  Host 填服务根地址即可,端点路径会自动拼接;也可直接粘贴完整端点。适用于 API 中转、One-API / New-API 网关、本地 Ollama、vLLM 等 OpenAI 兼容服务。
                </div>
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  {apiMode === "custom" && (
                    <button className="lb-btn" onClick={() => { setApiMode("builtin"); setApiModalOpen(false); }}
                      style={{ padding: "8px 16px", fontSize: 13, borderRadius: 8, background: "#fff",
                        border: `1px solid ${T.line}`, color: T.inkSoft }}>
                      停用,切回内置模型
                    </button>
                  )}
                  <button onClick={() => { setApiMode("custom"); setApiModalOpen(false); }}
                    style={{ marginLeft: "auto", padding: "8px 20px", fontSize: 13, fontWeight: 600, borderRadius: 8,
                      border: "none", background: T.indigo, color: "#fff", cursor: "pointer" }}>
                    {apiMode === "custom" ? "保存" : "启用自定义接入"}
                  </button>
                </div>
              </div>
            </div>
          )}

          <Fold title="写作技能" summary={skillSummary}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {skills.map(s => (
                <div key={s.id} className="lb-chip" role="button" tabIndex={0}
                  onClick={() => toggleSkill(s.id)}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSkill(s.id); } }}
                  style={{ padding: "9px 12px", borderRadius: 6,
                    background: s.enabled ? T.indigoBg : "#fff",
                    border: `1px solid ${s.enabled ? T.indigo : T.line}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0, display: "flex", alignItems: "center",
                      justifyContent: "center", fontSize: 10, color: "#fff",
                      background: s.enabled ? T.indigo : "transparent",
                      border: `1.5px solid ${s.enabled ? T.indigo : T.inkFaint}` }}>{s.enabled ? "✓" : ""}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis",
                      whiteSpace: "nowrap", color: s.enabled ? T.indigo : T.ink }}>{s.name}</span>
                    {s.builtin ? (
                      <span style={{ fontSize: 10, color: T.inkFaint, border: `1px solid ${T.line}`, borderRadius: 3, padding: "1px 5px", flexShrink: 0 }}>内置</span>
                    ) : (
                      <button onClick={e => { e.stopPropagation(); removeSkill(s.id); }} aria-label={`删除技能 ${s.name}`}
                        style={{ border: "none", background: "transparent", color: T.inkFaint, cursor: "pointer",
                          fontSize: 14, lineHeight: 1, padding: "2px 4px", flexShrink: 0 }}>×</button>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: T.inkFaint, marginTop: 5, lineHeight: 1.5, display: "-webkit-box",
                    WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{s.content}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
              <span style={{ fontSize: 11, color: T.inkFaint, lineHeight: 1.6, flex: 1 }}>
                启用的技能会在每次生成时生效
              </span>
              <button className="lb-btn" onClick={() => fileInputRef.current?.click()}
                style={{ padding: "4px 12px", fontSize: 12, borderRadius: 14, flexShrink: 0,
                  background: "#fff", border: `1px solid ${T.line}`, color: T.inkSoft }}>
                + 导入 .md / .txt
              </button>
              <input ref={fileInputRef} type="file" accept=".md,.txt,.markdown" multiple
                onChange={e => importSkills(e.target.files)} style={{ display: "none" }} />
            </div>
          </Fold>
        </aside>

        {/* ===== 右栏:创作区(编辑卡片自动生长填满高度,超长时栏内滚动) ===== */}
        <section style={{ display: "flex", flexDirection: "column", gap: 18, minHeight: 0, overflowY: "auto" }}>

          {/* 主题输入 + 落笔按钮 */}
          <div style={{ background: "#fff", border: `1px solid ${T.line}`, borderRadius: 10, padding: 18, display: "flex", gap: 14, alignItems: "stretch" }}>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              <textarea value={topic} onChange={e => setTopic(e.target.value)}
                placeholder={`想写什么?比如:「打工人如何用碎片时间自我提升」\n写下主题、关键词,或粘贴一段素材……`}
                rows={2}
                style={{ border: "none", resize: "none", fontSize: 15, lineHeight: 1.7, fontFamily: T.sans, color: T.ink, background: "transparent" }} />

              {/* 模型选择:下拉菜单,自定义接入走弹层 */}
              <div style={{ display: "flex", alignItems: "center", position: "relative" }}>
                <button className="lb-btn" onClick={() => setModelMenuOpen(o => !o)} aria-expanded={modelMenuOpen}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", fontSize: 12,
                    borderRadius: 14, background: "#fff", border: `1px solid ${T.line}`, color: T.inkSoft }}>
                  <span style={{ color: T.inkFaint }}>模型</span>
                  <span style={{ fontWeight: 600, color: T.ink }}>{modelSummary}</span>
                  <span style={{ fontSize: 9 }}>▾</span>
                </button>

                {modelMenuOpen && (
                  <>
                    <div onClick={() => setModelMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 30 }} />
                    <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 31, width: 300,
                      background: "#fff", border: `1px solid ${T.line}`, borderRadius: 8,
                      boxShadow: "0 8px 24px rgba(35,38,45,.12)", padding: 6 }}>
                      {MODELS.map(m => {
                        const active = apiMode === "builtin" && modelId === m.id;
                        return (
                          <button key={m.id} className="lb-menu-item"
                            onClick={() => { setApiMode("builtin"); setModelId(m.id); if (m.id !== "__custom__") setModelMenuOpen(false); }}
                            style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "baseline", gap: 8,
                              padding: "8px 10px", borderRadius: 6, border: "none", cursor: "pointer",
                              background: active ? T.indigoBg : "transparent" }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: active ? T.indigo : T.ink }}>{m.name}</span>
                            <span style={{ fontSize: 11, color: T.inkFaint }}>{m.desc}</span>
                            {active && <span style={{ marginLeft: "auto", color: T.indigo, fontSize: 12 }}>✓</span>}
                          </button>
                        );
                      })}
                      {apiMode === "builtin" && modelId === "__custom__" && (
                        <div style={{ padding: "2px 10px 8px" }}>
                          <input value={customModel} onChange={e => setCustomModel(e.target.value)}
                            placeholder="输入模型名称,回车确认" spellCheck={false} autoFocus
                            onKeyDown={e => { if (e.key === "Enter") setModelMenuOpen(false); }}
                            style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: 6,
                              border: `1px solid ${T.line}`, fontSize: 12, fontFamily: "monospace", color: T.ink, background: "#fff" }} />
                        </div>
                      )}
                      <div style={{ height: 1, background: T.line, margin: "6px 4px" }} />
                      <button className="lb-menu-item" onClick={() => { setModelMenuOpen(false); setApiModalOpen(true); }}
                        style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "baseline", gap: 8,
                          padding: "8px 10px", borderRadius: 6, border: "none", cursor: "pointer",
                          background: apiMode === "custom" ? T.indigoBg : "transparent" }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: apiMode === "custom" ? T.indigo : T.ink }}>自定义接入…</span>
                        <span style={{ fontSize: 11, color: T.inkFaint }}>{apiMode === "custom" ? "生效中 · 点击修改" : "自有 Host / Key"}</span>
                        {apiMode === "custom" && <span style={{ marginLeft: "auto", color: T.indigo, fontSize: 12 }}>✓</span>}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

            <button className="lb-seal" onClick={generate} disabled={busy}
              style={{ width: 76, borderRadius: 8, border: "none", background: T.seal, color: "#fff",
                fontFamily: T.serif, fontSize: 18, fontWeight: 700, letterSpacing: 3, writingMode: "vertical-rl" }}>
              {loading === "gen" ? "落墨中" : "落 笔"}
            </button>
          </div>

          {error && <div style={{ fontSize: 13, color: T.seal, padding: "0 4px" }}>{error}</div>}

          {/* 快捷操作条 */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {QUICK_ACTIONS.map(a => (
              <button key={a.id} className="lb-btn" onClick={() => runAction(a)} disabled={busy || !content}
                style={{ padding: "7px 14px", fontSize: 13, borderRadius: 20, background: "#fff", border: `1px solid ${T.line}`, color: T.inkSoft }}>
                {loading === a.id ? "处理中…" : a.name}
              </button>
            ))}
            <div style={{ width: 1, height: 18, background: T.line, margin: "0 4px" }} />
            <button className="lb-btn" onClick={genTitles} disabled={busy || (!content && !topic)}
              style={{ padding: "7px 14px", fontSize: 13, borderRadius: 20, background: "#fff", border: `1px solid ${T.line}`, color: T.inkSoft }}>
              {loading === "titles" ? "构思中…" : "起5个标题"}
            </button>
            <button className="lb-btn" onClick={copyAll} disabled={!content}
              style={{ marginLeft: "auto", padding: "7px 14px", fontSize: 13, borderRadius: 20,
                background: copied ? T.indigoBg : "#fff", border: `1px solid ${copied ? T.indigo : T.line}`, color: copied ? T.indigo : T.inkSoft }}>
              {copied ? "已复制 ✓" : "复制全文"}
            </button>
          </div>

          {/* 标题候选 */}
          {titles.length > 0 && (
            <div style={{ background: T.paperDeep, border: `1px solid ${T.line}`, borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 12, color: T.inkFaint, letterSpacing: 2, marginBottom: 10 }}>标题候选 · 点击设为标题</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {titles.map((t, i) => {
                  const picked = docTitle === t;
                  return (
                    <button key={i} className="lb-title-card"
                      onClick={() => setDocTitle(picked ? "" : t)}
                      style={{ textAlign: "left", padding: "10px 14px", borderRadius: 6,
                        background: picked ? T.indigoBg : "#fff",
                        border: `1px solid ${picked ? T.indigo : T.line}`,
                        fontSize: 14, lineHeight: 1.5, fontWeight: picked ? 600 : 400,
                        color: picked ? T.indigo : T.ink }}>
                      <span style={{ fontFamily: T.serif, color: picked ? T.indigo : T.inkFaint, marginRight: 10 }}>{"一二三四五"[i]}</span>{t}
                      {picked && <span style={{ float: "right", fontSize: 12 }}>✓ 已选用</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 正文编辑区 */}
          <div style={{ background: "#fff", border: `1px solid ${T.line}`, borderRadius: 10, minHeight: 200, position: "relative",
            flex: 1, display: "flex", flexDirection: "column" }}>
            {busy && loading !== "titles" && (
              <div style={{ position: "absolute", inset: 0, background: "rgba(250,249,245,.86)", display: "flex",
                alignItems: "center", justifyContent: "center", borderRadius: 10, zIndex: 5 }}>
                <div className="lb-loading" style={{ fontFamily: T.serif, fontSize: 18, color: T.inkSoft, letterSpacing: 4 }}>
                  笔尖游走<span>。</span><span>。</span><span>。</span>
                </div>
              </div>
            )}
            {!content && !docTitle && !busy ? (
              <div style={{ padding: "40px", textAlign: "center", margin: "auto" }}>
                <div style={{ fontFamily: T.serif, fontSize: 22, color: T.inkFaint, letterSpacing: 3, marginBottom: 12 }}>纸上空空,正待落笔</div>
                <div style={{ fontSize: 13, color: T.inkFaint, lineHeight: 2 }}>
                  在上方写下主题,选好平台与语气,点「落笔」<br />
                  生成后可以直接编辑,也可以一键换写法、扩写、精简、润色
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                {/* 文章标题:居中 + 加粗 + 宋体大字号,与正文视觉区分 */}
                <input className="lb-doc-title" value={docTitle} onChange={e => setDocTitle(e.target.value)}
                  placeholder="在此输入标题,或点「起5个标题」挑一个"
                  spellCheck={false}
                  style={{ width: "100%", boxSizing: "border-box", padding: "26px 32px 18px", border: "none",
                    borderBottom: `1px solid ${T.line}`, background: "transparent", textAlign: "center",
                    fontFamily: T.serif, fontSize: 23, fontWeight: 700, letterSpacing: 1, color: T.ink }} />
                <textarea ref={editorRef} value={content} onChange={e => setContent(e.target.value)}
                  style={{ width: "100%", flex: 1, minHeight: 120, padding: "24px 32px 28px", border: "none", resize: "none",
                    fontSize: 15, lineHeight: 2, fontFamily: T.sans, color: T.ink, background: "transparent", borderRadius: 10, boxSizing: "border-box" }} />
              </div>
            )}
          </div>

          <div style={{ fontSize: 12, color: T.inkFaint, textAlign: "center" }}>
            AI 生成的内容仅供参考,发布前请核实事实并加入你自己的观点
          </div>
        </section>
      </main>
    </div>
  );
}
