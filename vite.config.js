import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

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
        // accept 是给 Jina Reader 用的(application/json 才返回结构化正文);
        // x-api-key 同时服务于 Claude 格式与 Serper 搜索,两边头名恰好一致
        for (const h of ["content-type", "accept", "x-api-key", "authorization", "anthropic-version"]) {
          if (req.headers[h]) headers[h] = req.headers[h];
        }
        try {
          const upstream = await fetch(target, {
            method: req.method,
            headers,
            body: body.length ? body : undefined,
          });
          const ctype = upstream.headers.get("content-type") || "application/json";
          res.statusCode = upstream.status;
          res.setHeader("Content-Type", ctype);

          // SSE 必须边收边转发,整体缓冲会让流式输出退化成一次性返回
          if (ctype.includes("text/event-stream") && upstream.body) {
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");
            res.flushHeaders?.();
            const reader = upstream.body.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(Buffer.from(value));
            }
            res.end();
            return;
          }
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
  plugins: [react(), tailwindcss(), llmProxy()],
  server: { port: 5173 },
});
