// textarea 没有"取某段文字在屏幕上哪个位置"的原生 API。
// 做法:造一个和 textarea 排版规则完全一致的隐藏 div(镜像),把同一段文字塞进去,
// 用 span 包住目标区间,量 span 的 rect。只要有一条影响断行的 CSS 没同步,
// 整套坐标就会偏——所以属性清单宁多勿少。

const COPY_PROPS = [
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontVariant", "fontStretch",
  "letterSpacing", "lineHeight", "textTransform", "textIndent", "textAlign",
  "wordSpacing", "tabSize", "whiteSpace", "overflowWrap", "wordBreak", "direction",
];

// 单例:流式改写时每帧都要量,反复创建/销毁节点划不来;体积恒定,不必回收
let mirror = null;
function getMirror() {
  if (mirror) return mirror;
  mirror = document.createElement("div");
  mirror.setAttribute("aria-hidden", "true");
  // visibility:hidden 仍参与布局(量得到);display:none 量出来全是 0
  Object.assign(mirror.style, {
    position: "absolute",
    top: "0",
    left: "-9999px",
    visibility: "hidden",
    pointerEvents: "none",
    height: "auto",
    overflow: "hidden",
  });
  document.body.appendChild(mirror);
  return mirror;
}

/**
 * 量 textarea 里 [start, end) 这段文字的位置。
 * 返回的全是**视口坐标**(已减去 scrollTop/Left),调用方自己减容器 rect 换算成相对坐标。
 * rects 每个"视觉行"一个矩形——一段跨 3 行的选区会得到 3 个。
 *
 * @param {HTMLTextAreaElement} el
 * @param {number} start
 * @param {number} end
 * @returns {{rects:Array, first:Object, last:Object, viewLeft:number, viewTop:number, viewBottom:number, viewWidth:number}|null}
 */
export function measureRange(el, start, end) {
  if (!el || !(start >= 0) || !(start < end)) return null;
  const text = el.value; // 以 textarea 实际渲染的文本为准,不信任外部传来的快照
  if (end > text.length) return null;

  const cs = getComputedStyle(el);
  const m = getMirror();
  for (const p of COPY_PROPS) m.style[p] = cs[p];
  // clientWidth = 内容宽 + 左右 padding,已扣掉边框和(可能出现的)滚动条。
  // 配 border-box + 复制的 padding + 零边框,镜像的换行点才与 textarea 逐字对齐。
  // 用 offsetWidth 会在出滚动条时整体偏移。
  m.style.boxSizing = "border-box";
  m.style.borderWidth = "0px";
  m.style.width = el.clientWidth + "px";

  m.textContent = "";
  m.appendChild(document.createTextNode(text.slice(0, start)));
  const span = document.createElement("span");
  span.textContent = text.slice(start, end);
  m.appendChild(span);
  // 尾部文本必须带上:选区结尾若落在一个词/长串中间,后续字符会改变这一行的断行结果。
  // 末尾补零宽空格,避免结尾的换行被浏览器折叠掉导致最后一行量不出来。
  m.appendChild(document.createTextNode(text.slice(end) + "\u200B"));

  const mRect = m.getBoundingClientRect();
  const taRect = el.getBoundingClientRect();
  const bl = parseFloat(cs.borderLeftWidth) || 0;
  const bt = parseFloat(cs.borderTopWidth) || 0;

  // 镜像的 border-box 原点 ≙ textarea 的 padding-box 原点,所以补回边框宽度;
  // 再减 scrollTop/Left,得到"当前滚动位置下,这段文字在屏幕上的真实位置"
  const toView = (r) => {
    const left = taRect.left + bl + (r.left - mRect.left) - el.scrollLeft;
    const top = taRect.top + bt + (r.top - mRect.top) - el.scrollTop;
    return { left, top, width: r.width, height: r.height, right: left + r.width, bottom: top + r.height };
  };

  const rects = Array.from(span.getClientRects())
    .filter(r => r.height > 0) // 换行处会产生零高度空 rect,不过滤会画出细线
    .map(toView);
  if (rects.length === 0) return null;

  return {
    rects,
    first: rects[0],
    last: rects[rects.length - 1],
    // textarea 的可视内容框(视口坐标),用于裁剪高亮层 / 收敛浮条
    viewLeft: taRect.left + bl,
    viewTop: taRect.top + bt,
    viewBottom: taRect.top + bt + el.clientHeight,
    viewWidth: el.clientWidth,
  };
}

// 浮层横向夹取:浮条/菜单/接受条共用,免得各写一遍
export const clampX = (anchor, width, min, max) =>
  Math.max(min, Math.min(anchor, max - width));
