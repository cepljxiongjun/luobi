import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useApp } from "../store";

// ============ 模块导航(最左侧竖排导航栏) ============
const NAV_ITEMS = [
  { path: "/write", name: "写作", icon: "笔" },
  { path: "/imagetext", name: "图文", icon: "图" }, // 图文生成:长文拆卡片,导出发布图
  { path: "/articles", name: "文库", icon: "稿" }, // 文章库:已保存文章的管理
];

const navItemCls = ({ isActive }) =>
  "flex w-12 flex-col items-center gap-[3px] rounded-lg px-0 pt-[9px] pb-[7px] no-underline transition-all " +
  (isActive ? "bg-indigo-bg text-indigo" : "text-ink-soft hover:text-indigo");

function NavItem({ path, name, icon, className = "" }) {
  return (
    <NavLink to={path} title={name} className={state => navItemCls(state) + " " + className}>
      <span aria-hidden className="font-serif text-lg font-bold leading-none">{icon}</span>
      <span className="text-[10px] tracking-[1px]">{name}</span>
    </NavLink>
  );
}

// 应用外壳:左侧导航栏 + 顶栏,内容区由路由填充
export default function Layout() {
  const { content, articles } = useApp();
  const { pathname } = useLocation();
  const wordCount = content.replace(/\s/g, "").length;
  const headerNote = pathname.startsWith("/imagetext") ? "图文生成"
    : pathname.startsWith("/articles") ? (articles.length > 0 ? `文章库 · ${articles.length} 篇` : "文章库")
    : pathname.startsWith("/settings") ? "设置"
    : (wordCount > 0 ? `正文 ${wordCount} 字` : "今日,写点什么?");

  return (
    <div className="flex h-screen overflow-hidden bg-paper font-sans text-ink">
      {/* ===== 最左侧模块导航栏 ===== */}
      <nav aria-label="模块导航"
        className="flex w-16 shrink-0 flex-col items-center gap-5 border-r border-line bg-paper pt-3.5 pb-[18px]">
        <div className="flex h-[34px] w-[34px] items-center justify-center rounded bg-seal font-serif text-[17px] font-bold tracking-[1px] text-white">落</div>
        <div className="flex flex-col gap-2">
          {NAV_ITEMS.map(item => <NavItem key={item.path} {...item} />)}
        </div>
        {/* 设置入口:钉在导航栏底部 */}
        <NavItem path="/settings" name="设置" icon="设" className="mt-auto" />
      </nav>

      {/* ===== 右侧内容列:顶栏 + 当前页面 ===== */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b border-line bg-paper">
          <div className="mx-auto box-border flex w-full max-w-[1440px] items-center gap-3.5 px-7 py-3.5">
            <div>
              <div className="font-serif text-[19px] font-bold tracking-[2px]">落笔</div>
              <div className="text-[11px] tracking-[1px] text-ink-faint">为自媒体创作者而生的 AI 写作台</div>
            </div>
            <div className="ml-auto text-xs text-ink-faint">{headerNote}</div>
          </div>
        </header>
        <Outlet />
      </div>
    </div>
  );
}
