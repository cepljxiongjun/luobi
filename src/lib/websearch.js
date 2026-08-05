// ============ 联网:搜索后端 + 网页正文抓取 ============
//
// 调研结论(2026-07):面向 LLM 的搜索 API 已经是成熟品类,四家覆盖了绝大多数场景,
// 且**协议高度同构**——都是 POST JSON + 一个 Key 头,返回一个结果数组。所以这里
// 不做插件框架,只做一张「请求怎么拼 / 响应怎么读」的表,加一层归一化。
//
//   博查 Bocha   api.bochaai.com/v1/web-search        中文语料最好,DeepSeek 官方搜索源,响应沿用 Bing 结构
//   智谱 GLM     open.bigmodel.cn/api/paas/v4/web_search  已经在用 GLM 的人不必再申请第二个 Key
//   Tavily       api.tavily.com/search                 英文资料强,每月 1000 次免费
//   Serper       google.serper.dev/search              直接是 Google 结果,注册送 2500 次
//
// **不做"内置免配置搜索"**:搜索按次计费,内置就等于我替用户付钱,和模型层"用户自带 Key"
// 的范式也不一致。没配 Key 时联网功能整体不可用,而不是偷偷降级成不联网(那会让用户
// 以为稿子里的数据是查过的)。
//
// **归一化成 {title, url, snippet, site, date}**:上层(store / UI / 提示词)只认这个形状,
// 换搜索源不需要改任何调用点。
//
// 时效档位直接借用博查/智谱的词表(两家逐字相同),Tavily/Serper 在各自的 builder 里翻译。
// 自造一套枚举再翻译三遍没有收益。
//
// 网络通道复用 api.js 的 proxyFetch:桌面端走 Tauri 原生请求、浏览器 dev 走 Vite 代理、
// 浏览器生产直连(需目标服务允许跨域)。三种形态与模型调用完全一致。

import { proxyFetch, isTauri } from "./api";

export const SEARCH_PROVIDERS = [
  { id: "bocha", name: "博查", desc: "中文优先 · 按次计费", site: "https://open.bochaai.com",
    hint: "国内可直连,中文网页与资讯覆盖最好。Key 在 open.bochaai.com 控制台创建,按调用次数计费。" },
  { id: "zhipu", name: "智谱", desc: "已有 GLM Key 可直接用", site: "https://bigmodel.cn",
    hint: "用的就是智谱开放平台的 Key,和 GLM 模型共用一份。search_std 引擎,按次计费。" },
  { id: "tavily", name: "Tavily", desc: "英文资料强 · 每月 1000 次免费", site: "https://tavily.com",
    hint: "面向 LLM 的搜索,英文资料与学术内容更全,免费额度每月 1000 次。国内访问可能需要代理。" },
  { id: "serper", name: "Serper", desc: "Google 结果 · 注册送 2500 次", site: "https://serper.dev",
    hint: "直接返回 Google 搜索结果,注册赠送 2500 次。国内访问可能需要代理。" },
];

export const SEARCH_FRESHNESS = [
  { id: "noLimit", name: "不限" },
  { id: "oneDay", name: "一天内" },
  { id: "oneWeek", name: "一周内" },
  { id: "oneMonth", name: "一月内" },
  { id: "oneYear", name: "一年内" },
];

// 注入预算。与技能同一套理由:用户自带 Key,资料块每次请求都付钱,而且它比技能长得多
// (一条网页摘要就 200-400 字),上限必须更保守地卡住。整条要么全进要么全不进——
// 半条资料被截断后模型会拿着残缺的数字往下写,比不给还危险
export const REF_BUDGET = 8000;   // 资料块总字符上限
export const REF_MAX = 8;         // 同时注入的资料条数上限
export const REF_TEXT_MAX = 4000; // 单条抓回的正文存储上限

const clampInt = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt;
};

// 搜索源的摘要里可能夹着 <b> 高亮标签(博查沿用 Bing 结构,Bing 就是这么返回的)
const plain = (s, max = 300) =>
  String(s ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, max);

// 日期只留 YYYY-MM-DD:各家给的格式五花八门(ISO / 带时区 / 纯日期),
// 提示词里也只需要"什么时候的事",精确到秒没有意义
const day = (s) => {
  const m = String(s ?? "").match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  return m ? `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}` : "";
};

// 从 url 里取站点名当兜底(有些源不返回 siteName)
const hostOf = (u) => {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
};

export const searchConfigured = (cfg) =>
  !!(cfg && SEARCH_PROVIDERS.some(p => p.id === cfg.provider) && String(cfg.key || "").trim());

// ---- 各家的请求拼装 + 响应读取 ----
// 每个 builder 返回 { url, init, pick }:pick 拿到已解析的 JSON,返回归一化数组或抛人话错误

function buildRequest(query, cfg) {
  const key = String(cfg.key || "").trim();
  const count = clampInt(cfg.count, 1, 10, 5);
  const fresh = SEARCH_FRESHNESS.some(f => f.id === cfg.freshness) ? cfg.freshness : "noLimit";
  const json = (body, headers) => ({
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

  if (cfg.provider === "bocha") {
    return {
      url: "https://api.bochaai.com/v1/web-search",
      init: json({ query, count, freshness: fresh, summary: true }, { Authorization: `Bearer ${key}` }),
      pick: (d) => {
        // 博查在 HTTP 200 里用 body 的 code 表达业务错误,不看这一层会把报错当成"零结果"
        if (d.code && Number(d.code) !== 200) throw new Error(d.msg || d.message || `搜索失败(code ${d.code})`);
        return (d.data?.webPages?.value || []).map(r => ({
          title: plain(r.name, 120),
          url: r.url || "",
          snippet: plain(r.summary || r.snippet),
          site: plain(r.siteName, 40) || hostOf(r.url),
          date: day(r.datePublished),
        }));
      },
    };
  }

  if (cfg.provider === "zhipu") {
    return {
      url: "https://open.bigmodel.cn/api/paas/v4/web_search",
      init: json({ search_engine: "search_std", search_query: query, count,
        search_recency_filter: fresh }, { Authorization: `Bearer ${key}` }),
      pick: (d) => {
        if (d.error) throw new Error(d.error.message || "搜索失败");
        return (d.search_result || []).map(r => ({
          title: plain(r.title, 120),
          url: r.link || "",
          snippet: plain(r.content),
          site: plain(r.media, 40) || hostOf(r.link),
          date: day(r.publish_date),
        }));
      },
    };
  }

  if (cfg.provider === "tavily") {
    // time_range 用的是另一套词(day/week/month/year),noLimit 要整个不传而不是传 null
    const range = { oneDay: "day", oneWeek: "week", oneMonth: "month", oneYear: "year" }[fresh];
    return {
      url: "https://api.tavily.com/search",
      init: json({ query, max_results: count, search_depth: "basic", topic: "general",
        include_answer: false, ...(range ? { time_range: range } : {}) },
        { Authorization: `Bearer ${key}` }),
      pick: (d) => {
        if (d.error || d.detail) throw new Error(d.error || d.detail?.error || d.detail || "搜索失败");
        return (d.results || []).map(r => ({
          title: plain(r.title, 120),
          url: r.url || "",
          snippet: plain(r.content),
          site: hostOf(r.url),
          date: day(r.published_date),
        }));
      },
    };
  }

  if (cfg.provider === "serper") {
    const tbs = { oneDay: "qdr:d", oneWeek: "qdr:w", oneMonth: "qdr:m", oneYear: "qdr:y" }[fresh];
    return {
      url: "https://google.serper.dev/search",
      // gl/hl 固定中文区:这个工具的产出全是中文稿,搜出一堆英文结果不合用
      init: json({ q: query, num: count, gl: "cn", hl: "zh-cn", ...(tbs ? { tbs } : {}) },
        { "X-API-KEY": key }),
      pick: (d) => {
        if (d.message && !d.organic) throw new Error(d.message);
        return (d.organic || []).map(r => ({
          title: plain(r.title, 120),
          url: r.link || "",
          snippet: plain(r.snippet),
          site: hostOf(r.link),
          date: day(r.date),
        }));
      },
    };
  }

  throw new Error("还没有选择搜索源,请到设置页配置联网搜索");
}

function netError(what) {
  if (isTauri) return new Error(`无法连接${what}:请检查网络是否可达`);
  return new Error(import.meta.env.DEV
    ? "无法连接到本地代理:请确认 npm run dev 开发服务器正常运行"
    : `无法连接${what}:浏览器直连需要对方允许跨域(CORS),桌面端不受此限制`);
}

// HTTP 层的错误分类。搜索服务和模型服务的失败原因高度重合(Key 错、额度用完、地址不通),
// 但多一个「配额」——搜索是按次买的,429 在这里是最常见的失败,必须单独说清楚
function httpError(status, msg) {
  if (status === 401 || status === 403) return new Error(`搜索鉴权失败(HTTP ${status}):请检查搜索 API Key`);
  if (status === 429) return new Error("搜索次数已达上限(HTTP 429):请检查账户余额或稍后再试");
  if (status === 404) return new Error("搜索端点不存在(HTTP 404):该搜索源可能已变更接口");
  return new Error(msg || `搜索失败(HTTP ${status})`);
}

/** 联网搜索。返回归一化结果数组 [{title,url,snippet,site,date}] */
export async function webSearch(query, cfg) {
  const q = String(query || "").trim();
  if (!q) throw new Error("搜索关键词是空的");
  if (!searchConfigured(cfg)) throw new Error("还没有配置联网搜索:请到设置页选择搜索源并填入 Key");

  const { url, init, pick } = buildRequest(q.slice(0, 200), cfg);
  let res;
  try { res = await proxyFetch(url, init); } catch { throw netError("搜索服务"); }

  let data;
  try { data = await res.json(); } catch { throw httpError(res.status); }
  if (!res.ok) throw httpError(res.status, data?.error?.message || data?.msg || data?.message);

  const list = pick(data).filter(r => r.url && (r.title || r.snippet));
  if (list.length === 0) throw new Error("没有搜到相关结果,换个说法或放宽时间范围试试");
  return list;
}

/** 只测通不通:用一个固定的短查询走一遍真实链路,成功返回条数 */
export async function testSearch(cfg) {
  const list = await webSearch("落笔 AI 写作", { ...cfg, count: 3, freshness: "noLimit" });
  return list.length;
}

// ---- 网页正文抓取 ----
// 用 Jina Reader(r.jina.ai/<url>):把任意网页转成干净 markdown,免 Key 可用
// (20 次/分钟),填 Key 提到 200 次/分钟。**不自己解析 HTML**——正文抽取是个专门问题,
// 而且浏览器端根本抓不到别人的页面(CORS),自己做等于只有桌面端能用。
/** 抓取网页正文。返回 {title, url, text} */
export async function readUrl(target, cfg) {
  const u = String(target || "").trim();
  if (!/^https?:\/\//i.test(u)) throw new Error("请填一个完整的网址(以 http:// 或 https:// 开头)");

  const key = String(cfg?.readerKey || "").trim();
  let res;
  try {
    res = await proxyFetch(`https://r.jina.ai/${u}`, {
      method: "GET",
      // Accept: application/json 让 Reader 返回结构化结果,省掉解析它的纯文本头部
      headers: { Accept: "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    });
  } catch { throw netError("网页抓取服务"); }

  let data;
  try { data = await res.json(); } catch {
    if (res.status === 429) throw new Error("抓取太频繁(HTTP 429):稍后再试,或在设置页填入 Jina Key 提高限额");
    throw new Error(`抓取失败(HTTP ${res.status}):这个页面可能需要登录或禁止抓取`);
  }
  if (!res.ok || (data.code && Number(data.code) >= 400)) {
    throw new Error(data.message || `抓取失败(HTTP ${res.status}):这个页面可能需要登录或禁止抓取`);
  }

  const d = data.data || data;
  const text = String(d.content || "").trim();
  if (!text) throw new Error("这个页面没有抓到正文(可能是纯图片页或需要登录)");
  return {
    title: plain(d.title, 120) || hostOf(u),
    url: d.url || u,
    text: text.slice(0, REF_TEXT_MAX),
    site: hostOf(d.url || u),
    date: day(d.publishedTime),
  };
}

/**
 * 在系统默认浏览器里打开一条资料的原文链接。
 *
 * 桌面端的 WebView 会吞掉 target="_blank",必须走 opener 插件;capabilities 里配的是
 * `opener:allow-open-url` + `opener:allow-default-urls`,后者只放行 http/https/mailto/tel,
 * **不含 open-path**——所以这条通道打不开本地文件,与 fs 那套"只授命令不授 scope"的
 * 收紧方向一致。
 */
export async function openExternal(url) {
  const u = String(url || "");
  if (!/^https?:\/\//i.test(u)) return;
  if (isTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(u);
    return;
  }
  window.open(u, "_blank", "noopener,noreferrer");
}

// ---- 资料的注入 ----

const refBody = (r) => (r.text ? r.text.slice(0, REF_TEXT_MAX) : r.snippet || "");

// 一条资料渲染成提示词里的样子。先算长度再决定进不进,所以渲染和计量必须是同一个函数
const renderRef = (r, i) => {
  const head = [r.site, r.date].filter(Boolean).join(" · ");
  return `[${i}] ${r.title || "(无标题)"}${head ? ` —— ${head}` : ""}\n链接:${r.url}\n${refBody(r)}`;
};

/**
 * 按预算挑出这次真正注入的资料。与技能的 selectSkills 同一范式:
 * 整条要么全进要么全不进,被裁掉的返回给 UI 标注,不静默丢弃。
 * 顺序即优先级——用户在面板里看到的第一条就是最先进预算的那条。
 */
export function selectRefs(refs) {
  const used = [];
  const dropped = [];
  let chars = 0;
  for (const r of refs || []) {
    if (!r || r.picked === false) continue;
    const len = renderRef(r, used.length + 1).length + 2;
    if (used.length >= REF_MAX || (used.length > 0 && chars + len > REF_BUDGET)) {
      dropped.push(r);
      continue;
    }
    used.push(r);
    chars += len;
  }
  return { used, dropped, chars };
}

// 使用规则是这个功能的成败所在,而**写作和审稿要的是两套完全相反的规则**:
// 写作时资料是素材(别照搬、别硬用),审稿时资料是标尺(逐条比对、冲突就报出来)。
// 把写作那套注进发布前检查,检查器会开始给稿子"补充资料里的新信息",那不是它的职责。
const REF_RULES = {
  write:
    "使用规则:\n" +
    "1. 资料只作事实依据,不要整段照搬,更不要把资料的结构当成文章结构。\n" +
    "2. 用到里面的数据、时间、人名、机构时,在正文中自然带出来源(如「据某某报道」),不必列参考文献。\n" +
    "3. 资料与当前主题无关时直接忽略,不要为了用而用。\n" +
    "4. 资料里没有的信息一律不要写成有出处的样子,宁可不写。\n" +
    "5. 资料之间互相矛盾时,优先采信日期更近、来源更权威的那条,并在文中点明存在不同说法。",
  verify:
    "使用规则:\n" +
    "1. 拿这些资料核对正文里的时间、数字、人名、机构、事件经过是否与公开信息一致。\n" +
    "2. 正文与资料冲突时报成 type:\"fact\",在 reason 里写明资料怎么说、出自哪个来源。\n" +
    "3. 资料没覆盖到的说法,不要仅因为「资料里没有」就判定为错误。\n" +
    "4. 不要因为资料里有新信息就建议往正文里加内容——你的职责是挑错,不是补写。",
};

/**
 * 渲染成注入提示词的资料块。空数组返回空串,调用方可以无条件拼接。
 * mode: "write" 写作(默认)| "verify" 发布前检查
 */
export function renderRefsBlock(refs, mode = "write") {
  const { used } = selectRefs(refs);
  if (used.length === 0) return "";
  return "\n\n【联网检索到的参考资料】(共 " + used.length + " 条)\n" +
    (REF_RULES[mode] || REF_RULES.write) + "\n\n" +
    used.map((r, i) => renderRef(r, i + 1)).join("\n\n");
}

/** 勾选中的资料渲染成正文末尾的「参考来源」清单(用户手动插入,不自动加) */
export function renderSourceList(refs) {
  const { used } = selectRefs(refs);
  if (used.length === 0) return "";
  return "参考来源:\n" + used.map((r, i) =>
    `${i + 1}. ${r.title || r.url}${r.site ? `(${r.site}${r.date ? " " + r.date : ""})` : ""}\n   ${r.url}`
  ).join("\n");
}
