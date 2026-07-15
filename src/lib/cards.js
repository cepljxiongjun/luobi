// ============ 图文生成:主题 / 画幅 / 字号 / 拆卡 / 画布导出 ============
// 调研对标:MD2Card(长文拆卡+主题)、ai-xiaohs(排版+导出)、Canva/稿定(3:4 模板)
export const IT_THEMES = [
  { id: "ink", name: "宣纸墨", bg: "#FAF9F5", bg2: "#F2F0E9", fg: "#23262D", sub: "#5B5F68", accent: "#33529C", line: "#E3E1D8", chipFg: "#FFFFFF" },
  { id: "night", name: "靛蓝夜", bg: "#232E4D", bg2: "#1C2540", fg: "#F5F3EC", sub: "#B8BFD0", accent: "#E4C989", line: "#3A4568", chipFg: "#232E4D" },
  { id: "warm", name: "暖米", bg: "#F6EFE3", bg2: "#EFE5D2", fg: "#4A3B2A", sub: "#8A7A64", accent: "#C07840", line: "#E2D6BF", chipFg: "#FFFFFF" },
  { id: "celadon", name: "青瓷", bg: "#EAF1EC", bg2: "#DFEAE2", fg: "#2A3B33", sub: "#6E8377", accent: "#3E7B5E", line: "#CFDED4", chipFg: "#FFFFFF" },
];
export const IT_RATIOS = [
  { id: "3:4", name: "3:4 竖版", desc: "小红书首选", w: 1080, h: 1440 },
  { id: "1:1", name: "1:1 方形", desc: "通用画幅", w: 1080, h: 1080 },
];
export const IT_FONT_SIZES = [
  { id: "s", name: "小", scale: 0.88 },
  { id: "m", name: "标准", scale: 1 },
  { id: "l", name: "大", scale: 1.14 },
];

// 本地兜底拆卡:不依赖模型,按段落/句子切分
export function localSplitCards(source, fallbackTitle) {
  const text = source.trim();
  const paras = text.split(/\n+/).map(p => p.trim()).filter(Boolean);
  const firstLine = paras[0] || "";
  const title = (fallbackTitle || (firstLine.length <= 24 ? firstLine : firstLine.slice(0, 20))).slice(0, 24);
  const body = fallbackTitle || firstLine.length > 24 ? paras : paras.slice(1);
  // 把段落切成短句要点,每页装 3-4 条
  const points = [];
  body.forEach(p => {
    p.split(/(?<=[。!?!?;;])/).map(s => s.trim()).filter(Boolean)
      .forEach(s => points.push(s.length > 48 ? s.slice(0, 46) + "…" : s));
  });
  const pages = [];
  for (let i = 0; i < points.length && pages.length < 6; i += 4) {
    pages.push({ heading: `要点 ${"一二三四五六"[pages.length]}`, points: points.slice(i, i + 4) });
  }
  if (pages.length === 0) pages.push({ heading: "要点 一", points: [text.slice(0, 48) || "(空)"] });
  return { cover: { title: title || "未命名图文", tag: "图文笔记" }, pages };
}

// 校验/清洗 AI 返回的卡片 JSON
export function normalizeCards(data) {
  if (!data || typeof data.cover?.title !== "string" || !Array.isArray(data.pages)) return null;
  const pages = data.pages
    .filter(p => p && (Array.isArray(p.points) || typeof p.body === "string"))
    .slice(0, 8)
    .map((p, i) => ({
      heading: String(p.heading || `要点 ${"一二三四五六七八"[i]}`).slice(0, 16),
      points: (Array.isArray(p.points) ? p.points : [p.body]).map(x => String(x).trim()).filter(Boolean).slice(0, 5),
    }))
    .filter(p => p.points.length > 0);
  if (pages.length === 0) return null;
  return {
    cover: { title: data.cover.title.slice(0, 26), tag: String(data.cover.tag || "图文笔记").slice(0, 10) },
    pages,
  };
}

// canvas 逐字换行(中文按字断行,兼顾英文单词)
export function wrapCanvasText(ctx, text, maxWidth) {
  const lines = [];
  let line = "";
  for (const ch of text) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = ch; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

// 把一张卡片画到 canvas 上(cover 或内容页),返回 canvas
export function drawCardCanvas(card, kind, ctx0) {
  const { theme, ratio, scale, signature, pageIndex, pageTotal } = ctx0;
  const W = ratio.w, H = ratio.h;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const serif = '"Songti SC","Noto Serif SC","SimSun",serif';
  const sans = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';
  const PAD = 96;

  // 背景:纵向微渐变 + 边框内衬
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, theme.bg); grad.addColorStop(1, theme.bg2);
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = theme.line; ctx.lineWidth = 2;
  ctx.strokeRect(40, 40, W - 80, H - 80);

  if (kind === "cover") {
    const c = card.cover;
    // 顶部署名
    ctx.fillStyle = theme.sub; ctx.font = `500 ${30 * scale}px ${sans}`;
    ctx.fillText(signature || "落笔图文", PAD, 150);
    // 亮点标签(实心色块)
    ctx.font = `600 ${34 * scale}px ${sans}`;
    const tagW = ctx.measureText(c.tag).width + 56;
    const tagY = H * 0.32;
    ctx.fillStyle = theme.accent;
    ctx.fillRect(PAD, tagY, tagW, 64 * scale);
    ctx.fillStyle = theme.chipFg;
    ctx.fillText(c.tag, PAD + 28, tagY + 46 * scale);
    // 大标题(衬线粗体,最多4行)
    ctx.fillStyle = theme.fg; ctx.font = `700 ${86 * scale}px ${serif}`;
    const titleLines = wrapCanvasText(ctx, c.title, W - PAD * 2).slice(0, 4);
    titleLines.forEach((ln, i) => ctx.fillText(ln, PAD, tagY + 220 * scale + i * 118 * scale));
    // 底部提示
    ctx.fillStyle = theme.sub; ctx.font = `400 ${30 * scale}px ${sans}`;
    ctx.fillText("左滑查看全文  →", PAD, H - 130);
    ctx.strokeStyle = theme.accent; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(PAD, H - 190); ctx.lineTo(PAD + 120, H - 190); ctx.stroke();
  } else {
    const p = card;
    // 右上角大页码(淡)
    ctx.fillStyle = theme.line; ctx.font = `700 ${170 * scale}px ${serif}`;
    const numStr = String(pageIndex + 1).padStart(2, "0");
    ctx.fillText(numStr, W - PAD - ctx.measureText(numStr).width, 240);
    // 小标题 + 侧色条
    ctx.fillStyle = theme.accent; ctx.fillRect(PAD, 180, 12, 64 * scale);
    ctx.fillStyle = theme.fg; ctx.font = `700 ${58 * scale}px ${serif}`;
    ctx.fillText(p.heading, PAD + 40, 232);
    // 要点列表
    let y = 380;
    const bodySize = 40 * scale, lineH = 66 * scale, gap = 46 * scale;
    ctx.font = `400 ${bodySize}px ${sans}`;
    p.points.forEach(pt => {
      if (y > H - 220) return;
      ctx.fillStyle = theme.accent;
      ctx.beginPath(); ctx.arc(PAD + 12, y - bodySize * 0.32, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = theme.fg;
      const lines = wrapCanvasText(ctx, pt, W - PAD * 2 - 60);
      lines.forEach(ln => { if (y <= H - 200) { ctx.fillText(ln, PAD + 48, y); y += lineH; } });
      y += gap;
    });
    // 页脚:署名 + 页码
    ctx.strokeStyle = theme.line; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(PAD, H - 170); ctx.lineTo(W - PAD, H - 170); ctx.stroke();
    ctx.fillStyle = theme.sub; ctx.font = `400 ${28 * scale}px ${sans}`;
    ctx.fillText(signature || "落笔图文", PAD, H - 108);
    const pg = `${pageIndex + 1} / ${pageTotal}`;
    ctx.fillText(pg, W - PAD - ctx.measureText(pg).width, H - 108);
  }
  return canvas;
}
