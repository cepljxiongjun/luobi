// ============ 模型配置 ============
export const MODELS = [
  { id: "claude-sonnet-4-6", name: "Sonnet 4.6", desc: "均衡首选 · 快且稳" },
  { id: "claude-opus-4-8", name: "Opus 4.8", desc: "深度长文 · 更强表达" },
  { id: "claude-haiku-4-5-20251001", name: "Haiku 4.5", desc: "极速出稿 · 轻量任务" },
  { id: "__custom__", name: "自定义", desc: "手动输入模型名称" },
];

// ============ API 调用层:内置通道 / 自定义 Host(Claude 格式 或 OpenAI 兼容格式) ============
export function buildEndpoint(host, path) {
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
export const isTauri = typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

export async function proxyFetch(url, options) {
  if (isTauri) {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    return tauriFetch(url, options);
  }
  if (import.meta.env.DEV) {
    return fetch("/llm-proxy", { ...options, headers: { ...options.headers, "x-proxy-target": url } });
  }
  return fetch(url, options);
}

export async function callAI(userPrompt, systemHint, api) {
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

// 测试连接并拉取模型列表:GET {host}/v1/models
// OpenAI 兼容服务(Ollama / vLLM / LM Studio / DeepSeek / 网关)与 Anthropic 均支持该端点
export async function listModels(api) {
  if (!api.host.trim()) throw new Error("请先填写 API Host 地址");
  const endpoint = buildEndpoint(api.host, "/v1/models");

  let res;
  try {
    const headers = api.format === "anthropic"
      ? {
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
          ...(api.key.trim() ? { "x-api-key": api.key.trim() } : {}),
        }
      : (api.key.trim() ? { Authorization: `Bearer ${api.key.trim()}` } : {});
    res = await proxyFetch(endpoint, { method: "GET", headers });
  } catch {
    if (isTauri) throw new Error("无法连接到该 Host:请检查地址是否正确、服务是否已启动");
    throw new Error(import.meta.env.DEV
      ? "无法连接到本地代理:请确认 npm run dev 开发服务器正常运行"
      : "无法连接到该 Host:请检查地址、服务是否启动,以及是否允许跨域(本地 Ollama 需设置 OLLAMA_ORIGINS)");
  }

  let data;
  try { data = await res.json(); } catch {
    if (res.status === 404) throw new Error(`目标服务返回 404:该服务可能不支持 /v1/models(实际请求:${endpoint})`);
    if (res.status === 401 || res.status === 403) throw new Error(`鉴权失败(HTTP ${res.status}):请检查 API Key`);
    throw new Error(`服务返回了非 JSON 内容(HTTP ${res.status}),请检查 Host 与格式选择`);
  }
  if (data.error) throw new Error(data.error.message || `请求失败(HTTP ${res.status})`);
  if (!res.ok) throw new Error(`请求失败(HTTP ${res.status})`);

  const ids = (Array.isArray(data.data) ? data.data : (Array.isArray(data.models) ? data.models : []))
    .map(m => m.id || m.name).filter(Boolean);
  if (ids.length === 0) throw new Error("已连通,但服务未返回任何模型(可能还没拉取/加载模型)");
  return ids;
}
