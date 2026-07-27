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

function connError() {
  if (isTauri) return new Error("无法连接到该 Host:请检查地址是否正确、网络是否可达");
  return new Error(import.meta.env.DEV
    ? "无法连接到本地代理:请确认 npm run dev 开发服务器正常运行"
    : "无法连接到该 Host:请检查地址是否正确,以及服务端是否允许浏览器跨域(CORS)访问");
}

// 组装一次请求:内置通道 / 自定义 Claude 格式 / 自定义 OpenAI 兼容格式,stream 决定是否要 SSE
function prepareRequest(userPrompt, systemHint, api, stream) {
  const userContent = `${userPrompt}\n\n直接输出正文,不要任何前言或解释。`;

  // ---- 内置通道:免配置,走平台自带的 Claude 接口 ----
  if (api.mode === "builtin") {
    return {
      format: "anthropic",
      url: "https://api.anthropic.com/v1/messages",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: api.model || "claude-sonnet-4-6",
          max_tokens: 2000, // 与自定义通道一致;1000 会截断公众号 800-1200 字长文
          messages: [{ role: "user", content: `${systemHint}\n\n${userContent}` }],
          ...(stream ? { stream: true } : {}),
        }),
      },
    };
  }

  // ---- 自定义接入:校验必填项 ----
  if (!api.host.trim()) throw new Error("请先填写 API Host 地址");
  if (!api.model.trim()) throw new Error("请先填写模型名称");

  const format = api.format === "anthropic" ? "anthropic" : "openai";
  const url = buildEndpoint(api.host, format === "anthropic" ? "/v1/messages" : "/v1/chat/completions");

  const body = format === "anthropic"
    ? { model: api.model.trim(), max_tokens: 2000, system: systemHint, messages: [{ role: "user", content: userContent }] }
    : { model: api.model.trim(), max_tokens: 2000,
        messages: [{ role: "system", content: systemHint }, { role: "user", content: userContent }] };
  if (stream) body.stream = true;

  const headers = format === "anthropic"
    ? { "Content-Type": "application/json", "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        ...(api.key.trim() ? { "x-api-key": api.key.trim() } : {}) }
    : { "Content-Type": "application/json",
        ...(api.key.trim() ? { Authorization: `Bearer ${api.key.trim()}` } : {}) };

  return { format, url, init: { method: "POST", headers, body: JSON.stringify(body) } };
}

// 一次性响应 → 取正文(同时负责各类错误的分类提示)
async function readJsonResult(res, format, endpoint) {
  let data;
  try { data = await res.json(); } catch {
    if (res.status === 404) throw new Error(`目标服务返回 404:端点不存在,请检查 Host 填写是否正确(实际请求:${endpoint})`);
    if (res.status === 401 || res.status === 403) throw new Error(`鉴权失败(HTTP ${res.status}):请检查 API Key 是否正确`);
    throw new Error(`服务返回了非 JSON 内容(HTTP ${res.status}),请检查 Host 与格式选择`);
  }

  if (format === "anthropic") {
    if (data.type === "error" || !data.content) throw new Error(data.error?.message || `调用失败(HTTP ${res.status})`);
    const blocks = Array.isArray(data.content) ? data.content : [];
    return blocks.filter(b => b.type === "text").map(b => b.text).join("\n").trim();
  }
  if (data.error) throw new Error(data.error.message || `调用失败(HTTP ${res.status})`);
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error(`响应格式不符合 OpenAI 规范(HTTP ${res.status}),请确认格式选择是否正确`);
  return text.trim();
}

export async function callAI(userPrompt, systemHint, api) {
  const { format, url, init } = prepareRequest(userPrompt, systemHint, api, false);
  let res;
  try { res = await proxyFetch(url, init); } catch { throw connError(); }
  return readJsonResult(res, format, url);
}

// 解析一行 SSE,返回本次增量文本(非数据行返回空串)
function sseLineDelta(line, format) {
  const s = line.trim();
  if (!s.startsWith("data:")) return "";
  const payload = s.slice(5).trim();
  if (!payload || payload === "[DONE]") return "";
  let evt;
  try { evt = JSON.parse(payload); } catch { return ""; }
  if (evt.type === "error" || evt.error) throw new Error(evt.error?.message || "模型返回错误");
  return format === "anthropic"
    ? (evt.type === "content_block_delta" ? (evt.delta?.text || "") : "")
    : (evt.choices?.[0]?.delta?.content || "");
}

// 流式调用:onDelta(已累积的全文) 每收到增量回调一次,返回最终全文
// 服务端不支持流式(返回普通 JSON)时自动退回一次性结果,不报错
export async function callAIStream(userPrompt, systemHint, api, onDelta) {
  const { format, url, init } = prepareRequest(userPrompt, systemHint, api, true);
  let res;
  try { res = await proxyFetch(url, init); } catch { throw connError(); }

  const ctype = res.headers?.get?.("content-type") || "";
  if (!res.ok || !ctype.includes("text/event-stream")) return readJsonResult(res, format, url);

  let full = "";
  const emit = (line) => { const d = sseLineDelta(line, format); if (d) { full += d; onDelta?.(full); } };

  if (res.body?.getReader) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? ""; // 末段可能被截断,留到下一片再拼
      lines.forEach(emit);
    }
    if (buf) emit(buf);
  } else {
    // 个别 WebView 不给可读流 → 整体拿到后再按 SSE 解析(仍能出结果,只是没有逐字效果)
    (await res.text()).split("\n").forEach(emit);
  }

  if (!full.trim()) throw new Error("模型没有返回内容,请重试");
  return full.trim();
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
