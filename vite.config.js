import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 本地 LLM 代理:前端把真实目标地址放在 x-proxy-target 头里 POST 到 /llm-proxy,
// 由 Vite 开发服务器在 Node 侧转发,绕开浏览器 CORS 限制(生产部署需自备后端代理)
function llmProxy() {
  return {
    name: "llm-proxy",
    configureServer(server) {
      server.middlewares.use("/llm-proxy", async (req, res) => {
        const target = req.headers["x-proxy-target"];
        res.setHeader("Content-Type", "application/json");
        if (!target || !/^https?:\/\//i.test(target)) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: { message: "缺少有效的 x-proxy-target 转发地址" } }));
          return;
        }
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        const headers = {};
        for (const h of ["content-type", "x-api-key", "authorization", "anthropic-version"]) {
          if (req.headers[h]) headers[h] = req.headers[h];
        }
        try {
          const upstream = await fetch(target, {
            method: req.method,
            headers,
            body: body.length ? body : undefined,
          });
          res.statusCode = upstream.status;
          res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
          res.end(Buffer.from(await upstream.arrayBuffer()));
        } catch (e) {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: { message: `本地代理无法连接目标服务:${e.message}` } }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), llmProxy()],
  server: { port: 5173 },
});
