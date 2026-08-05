// ============ 版本对比:句级 diff(纯函数,零依赖) ============
//
// 为什么按「句」而不是按「行」:中文稿子的一个自然段常是一整行,行级 diff 会把
// 改了三个字的段落整段标成"删了又加",看不出到底改了哪。切到句子粒度,
// 对比结果就像编辑的红线稿——没动的句子原样,删的划掉,新的标出来。
//
// 算法是教科书 LCS(动态规划),先掐掉公共前后缀把 DP 规模压下来;
// 极端超长文本(几万句)直接退化成"整篇替换",不让页面卡死。

// 切句:句号/叹号/问号/分号(中英)与换行后断开,分隔符保留在句尾,
// 这样 join 回去与原文逐字一致(渲染层靠这一点保持段落排版)
export function splitSegments(text) {
  const s = String(text ?? "");
  if (!s) return [];
  return s.split(/(?<=[。!?;!?;\n])/).filter(x => x.length > 0);
}

/**
 * 句级 diff。返回 [{type: 'same'|'del'|'add', text}],
 * del 来自 oldText、add 来自 newText,顺序即阅读顺序。
 */
export function diffSegments(oldText, newText) {
  const a = splitSegments(oldText);
  const b = splitSegments(newText);

  // 掐公共前缀/后缀:日常改稿只动中间几句,DP 规模从全文降到改动区
  let lo = 0;
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++;
  let hiA = a.length, hiB = b.length;
  while (hiA > lo && hiB > lo && a[hiA - 1] === b[hiB - 1]) { hiA--; hiB--; }
  const midA = a.slice(lo, hiA);
  const midB = b.slice(lo, hiB);

  const head = a.slice(0, lo).map(text => ({ type: "same", text }));
  const tail = a.slice(hiA).map(text => ({ type: "same", text }));

  // 超长防线:DP 是 O(n*m),中段超过 ~4M 格就放弃细比,整块删/加
  if (midA.length * midB.length > 4_000_000) {
    return [...head,
      ...midA.map(text => ({ type: "del", text })),
      ...midB.map(text => ({ type: "add", text })), ...tail];
  }

  const n = midA.length, m = midB.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = midA[i] === midB[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const mid = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) { mid.push({ type: "same", text: midA[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { mid.push({ type: "del", text: midA[i] }); i++; }
    else { mid.push({ type: "add", text: midB[j] }); j++; }
  }
  while (i < n) mid.push({ type: "del", text: midA[i++] });
  while (j < m) mid.push({ type: "add", text: midB[j++] });

  return [...head, ...mid, ...tail];
}

/** 统计增删句数与字数,面板头部用 */
export function diffStats(segs) {
  let addSeg = 0, delSeg = 0, addChars = 0, delChars = 0;
  for (const s of segs) {
    const len = s.text.replace(/\s/g, "").length;
    if (s.type === "add") { addSeg++; addChars += len; }
    if (s.type === "del") { delSeg++; delChars += len; }
  }
  return { addSeg, delSeg, addChars, delChars };
}
