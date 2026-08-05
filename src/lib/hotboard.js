// ============ 全网热榜(选题灵感的数据源之一) ============
//
// 易撰这类工具的立身之本是聚合 30+ 平台的热榜。我们不自建爬虫(维护成本无底洞),
// 用公开的热榜聚合接口:一次请求拿回微博/知乎/百度/头条/抖音/B站等榜单。
// 免 Key 免费——与「不做内置搜索」并不矛盾:那条红线针对的是按次计费、
// 内置等于替用户付钱的服务;热榜聚合是免费公共接口,和 Jina Reader 免 Key 档同一性质。
//
// 与搜索层同一套写法:一个入口 + 归一化,上层只认 {id, name, items:[{title, heat, url}]}。
// 接口挂了就报人话错误,不影响其余功能——热榜是增强,不是前置条件。
//
// 网络通道复用 proxyFetch:桌面端原生请求、浏览器 dev 走 Vite 代理、生产直连
// (该接口返回 Access-Control-Allow-Origin: *,浏览器可直连;若失效同样报错不装死)。

import { proxyFetch, isTauri } from "./api";

const HOT_URL = "https://api.vvhan.com/api/hotlist/all";

// 想展示的榜单与顺序:自媒体选题的主战场在前。接口返回的名字偶有变化
// (「百度热点」vs「百度热搜」),所以用关键词匹配而不是全名相等
const BOARD_KEYS = [
  { id: "weibo", name: "微博", match: "微博" },
  { id: "zhihu", name: "知乎", match: "知乎" },
  { id: "toutiao", name: "头条", match: "头条" },
  { id: "baidu", name: "百度", match: "百度" },
  { id: "douyin", name: "抖音", match: "抖音" },
  { id: "bili", name: "B站", match: "B站" },
];

export const HOT_ITEM_MAX = 15; // 每个榜只留前 15:选题看的是头部,不是长尾

const clean = (s, max = 60) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** 拉取全网热榜,归一化成 [{id, name, items:[{title, heat, url}]}](只含 BOARD_KEYS 里配的) */
export async function fetchHotBoards() {
  let res;
  try {
    res = await proxyFetch(HOT_URL, { method: "GET", headers: { Accept: "application/json" } });
  } catch {
    throw new Error(isTauri
      ? "热榜服务连不上:请检查网络"
      : "热榜服务连不上:请检查网络(生产环境直连需对方允许跨域)");
  }
  let data;
  try { data = await res.json(); } catch { throw new Error(`热榜服务异常(HTTP ${res.status}),稍后再试`); }
  if (!res.ok || data.success === false || !Array.isArray(data.data)) {
    throw new Error("热榜服务暂不可用,稍后再试");
  }

  const boards = [];
  for (const key of BOARD_KEYS) {
    const raw = data.data.find(b => String(b?.name || "").includes(key.match));
    if (!raw || !Array.isArray(raw.data)) continue;
    const items = raw.data
      .map(it => ({
        title: clean(it.title),
        heat: clean(it.hot, 12),
        url: typeof it.url === "string" && /^https?:\/\//i.test(it.url) ? it.url : "",
      }))
      .filter(it => it.title)
      .slice(0, HOT_ITEM_MAX);
    if (items.length) boards.push({ id: key.id, name: key.name, items, updated: clean(raw.update_time, 20) });
  }
  if (boards.length === 0) throw new Error("热榜服务没有返回可用的榜单,稍后再试");
  return boards;
}
