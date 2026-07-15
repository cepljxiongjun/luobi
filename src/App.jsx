import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppProvider } from "./store";
import Layout from "./components/Layout";
import WritePage from "./pages/WritePage";
import ImageTextPage from "./pages/ImageTextPage";
import SettingsPage from "./pages/SettingsPage";

// HashRouter:Tauri 生产环境从本地文件加载 index.html,hash 路由无需服务端 fallback
export default function App() {
  return (
    <HashRouter>
      <AppProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/write" element={<WritePage />} />
            <Route path="/imagetext" element={<ImageTextPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/write" replace />} />
          </Route>
        </Routes>
      </AppProvider>
    </HashRouter>
  );
}
