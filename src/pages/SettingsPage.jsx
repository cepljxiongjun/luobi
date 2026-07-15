import { useState } from "react";
import { useApp } from "../store";
import { MODELS, listModels } from "../lib/api";
import { chipCls, btnCls, inputCls, sectionLabelCls } from "../ui";

const API_FORMATS = [
  { id: "anthropic", name: "Claude 格式", path: "/v1/messages" },
  { id: "openai", name: "OpenAI 兼容", path: "/v1/chat/completions" },
];

// 常用服务预设(调研:Ollama/vLLM/LM Studio 均为 OpenAI 兼容协议,支持 GET /v1/models)
const PROVIDER_PRESETS = [
  { id: "ollama", name: "Ollama", host: "http://localhost:11434", format: "openai",
    hint: "本地默认端口 11434,无需 Key。桌面端/开发模式可直连;浏览器生产直连需启动时设置 OLLAMA_ORIGINS 允许跨域。" },
  { id: "vllm", name: "vLLM", host: "http://localhost:8000", format: "openai",
    hint: "默认端口 8000。若服务启动时加了 --api-key,请在下方填同样的 Key。" },
  { id: "lmstudio", name: "LM Studio", host: "http://localhost:1234", format: "openai",
    hint: "本地默认端口 1234,无需 Key,先在 LM Studio 里启动本地服务器并加载模型。" },
  { id: "deepseek", name: "DeepSeek", host: "https://api.deepseek.com", format: "openai",
    hint: "填官网申请的 API Key,常用模型:deepseek-chat / deepseek-reasoner。" },
  { id: "zhipu", name: "智谱 GLM", host: "https://open.bigmodel.cn/api/paas/v4", format: "openai",
    hint: "Key 在智谱开放平台创建,常用模型:glm-4-plus / glm-4-flash。" },
];

export default function SettingsPage() {
  const {
    apiMode, setApiMode, apiFormat, setApiFormat, apiHost, setApiHost,
    apiKey, setApiKey, customApiModel, setCustomApiModel,
    customModels, addCustomModel, removeCustomModel,
    savedProviders, saveProvider, removeProvider, applyProvider,
    modelId, setModelId, customModel, setCustomModel, modelSummary,
  } = useApp();
  const [presetHint, setPresetHint] = useState("");   // 选中预设后的接入提示
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // {ok, msg, models?}
  const [newModelName, setNewModelName] = useState(""); // 手动添加模型的输入框
  const [newProviderName, setNewProviderName] = useState(""); // 保存常用服务的命名输入框

  const submitNewModel = () => {
    if (!newModelName.trim()) return;
    addCustomModel(newModelName);
    setNewModelName("");
  };

  const submitSaveProvider = () => {
    if (!newProviderName.trim() || !apiHost.trim()) return;
    saveProvider(newProviderName);
    setNewProviderName("");
  };

  const applyPreset = (p) => {
    setApiFormat(p.format); setApiHost(p.host);
    setPresetHint(p.hint); setTestResult(null);
  };

  const testConnection = async () => {
    setTesting(true); setTestResult(null);
    try {
      const models = await listModels({ format: apiFormat, host: apiHost, key: apiKey });
      setTestResult({ ok: true, models });
    } catch (e) {
      setTestResult({ ok: false, msg: e.message || "连接失败" });
    }
    setTesting(false);
  };

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border flex max-w-[620px] flex-col gap-6 px-7 pt-7 pb-12">
        <div>
          <div className="font-serif text-xl font-bold tracking-[2px]">模型设置</div>
          <div className="mt-[5px] text-xs text-ink-faint">选择内置模型,或接入自有服务;修改即时生效并自动保存在本机</div>
        </div>

        {/* 接入方式 */}
        <section>
          <div className={sectionLabelCls + " mb-2.5"}>接入方式</div>
          <div className="grid grid-cols-2 gap-2">
            {[{ id: "builtin", name: "内置模型", desc: "免配置 · 平台通道" },
              { id: "custom", name: "自定义接入", desc: "自有 Host / Key,可接中转与本地服务" }].map(m => (
              <button key={m.id} onClick={() => setApiMode(m.id)}
                className={chipCls(apiMode === m.id) + " px-3.5 py-3"}>
                <div className={"text-sm font-semibold " + (apiMode === m.id ? "text-indigo" : "text-ink")}>{m.name}</div>
                <div className="mt-[3px] text-[11px] text-ink-faint">{m.desc}</div>
              </button>
            ))}
          </div>
        </section>

        {apiMode === "builtin" ? (
          <section>
            <div className={sectionLabelCls + " mb-2.5"}>内置模型</div>
            <div className="flex flex-col gap-2">
              {MODELS.map(m => {
                const active = modelId === m.id;
                return (
                  <button key={m.id} onClick={() => setModelId(m.id)}
                    className={chipCls(active) + " flex items-baseline gap-2.5 px-3.5 py-[11px]"}>
                    <span className={"text-sm font-semibold " + (active ? "text-indigo" : "text-ink")}>{m.name}</span>
                    <span className="text-[11px] text-ink-faint">{m.desc}</span>
                    {active && <span className="ml-auto text-xs text-indigo">✓</span>}
                  </button>
                );
              })}
            </div>
            {modelId === "__custom__" && (
              <input value={customModel} onChange={e => setCustomModel(e.target.value)}
                placeholder="输入模型名称,如 claude-sonnet-4-6" spellCheck={false}
                className={inputCls + " mt-2"} />
            )}
            <div className="mt-2.5 rounded-md bg-paper-deep px-2.5 py-2 text-[11px] leading-[1.7] text-ink-faint">
              内置通道直连 api.anthropic.com,本地运行仍需服务端鉴权;没有官方 Key 时请改用「自定义接入」。
            </div>
          </section>
        ) : (
          <section>
            <div className={sectionLabelCls + " mb-2.5"}>自定义接入</div>
            <div className="flex flex-col gap-3">
              <div>
                <div className="mb-1.5 text-[11px] text-ink-faint">常用服务(点击填入;可把当前配置保存为自定义服务)</div>
                <div className="flex flex-wrap gap-2">
                  {PROVIDER_PRESETS.map(p => {
                    const active = apiHost.trim() === p.host;
                    return (
                      <button key={p.id} onClick={() => applyPreset(p)}
                        className={"cursor-pointer rounded-full border px-3 py-1 text-xs transition-all " +
                          (active ? "border-indigo bg-indigo-bg font-semibold text-indigo" : "border-line bg-white text-ink-soft hover:border-indigo hover:text-indigo")}>
                        {p.name}
                      </button>
                    );
                  })}
                  {/* 用户保存的自定义服务:名称自定义,点击载入整套配置(Host/格式/Key/模型列表) */}
                  {savedProviders.map(p => {
                    const active = apiHost.trim() === p.host && apiFormat === p.format;
                    return (
                      <div key={p.id} role="button" tabIndex={0}
                        onClick={() => { applyProvider(p); setPresetHint(`${p.host} · ${p.format === "anthropic" ? "Claude 格式" : "OpenAI 兼容"} · ${(p.models || []).length} 个模型`); setTestResult(null); }}
                        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); applyProvider(p); } }}
                        title={p.host}
                        className={"flex cursor-pointer items-center gap-1 rounded-full border py-1 pl-3 pr-1.5 text-xs transition-all " +
                          (active ? "border-indigo bg-indigo-bg font-semibold text-indigo" : "border-dashed border-ink-faint bg-white text-ink-soft hover:border-indigo hover:text-indigo")}>
                        <span>{p.name}</span>
                        <button onClick={e => { e.stopPropagation(); removeProvider(p.id); }} aria-label={`删除常用服务 ${p.name}`}
                          className="cursor-pointer border-none bg-transparent px-0.5 text-[13px] leading-none text-ink-faint hover:text-seal">×</button>
                      </div>
                    );
                  })}
                </div>
                {presetHint && (
                  <div className="mt-2 rounded-md bg-paper-deep px-2.5 py-2 text-[11px] leading-[1.7] text-ink-faint">{presetHint}</div>
                )}
                <div className="mt-2 flex gap-2">
                  <input value={newProviderName} onChange={e => setNewProviderName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") submitSaveProvider(); }}
                    placeholder="起个名字(如:公司网关),把下方配置存为常用服务"
                    spellCheck={false} maxLength={20}
                    className={inputCls + " flex-1 !font-sans"} />
                  <button onClick={submitSaveProvider} disabled={!newProviderName.trim() || !apiHost.trim()}
                    className={btnCls + " shrink-0 rounded-md px-3.5 text-xs"}>
                    保存为常用
                  </button>
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-[11px] text-ink-faint">API 格式</div>
                <div className="grid grid-cols-2 gap-2">
                  {API_FORMATS.map(f => (
                    <button key={f.id} onClick={() => setApiFormat(f.id)}
                      className={chipCls(apiFormat === f.id) + " px-2.5 py-2"}>
                      <div className={"text-xs font-semibold " + (apiFormat === f.id ? "text-indigo" : "text-ink")}>{f.name}</div>
                      <div className="mt-0.5 font-mono text-[10px] text-ink-faint">{f.path}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-[11px] text-ink-faint">API Host</div>
                <input value={apiHost} onChange={e => setApiHost(e.target.value)}
                  placeholder={apiFormat === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com"}
                  spellCheck={false} className={inputCls} />
              </div>
              <div>
                <div className="mb-1.5 text-[11px] text-ink-faint">API Key(保存在本机,不会上传;桌面端存于应用数据目录)</div>
                <input value={apiKey} onChange={e => setApiKey(e.target.value)} type="password"
                  placeholder="sk-…(无需鉴权的服务可留空)"
                  autoComplete="off" spellCheck={false} className={inputCls} />
              </div>
              <div>
                <div className="mb-1.5 text-[11px] text-ink-faint">模型列表(可添加多个;点击切换当前使用,写作页下拉可快速切换)</div>
                {customModels.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {customModels.map(m => {
                      const active = customApiModel === m;
                      return (
                        <div key={m} role="button" tabIndex={0}
                          onClick={() => setCustomApiModel(m)}
                          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCustomApiModel(m); } }}
                          className={"flex cursor-pointer items-center gap-1.5 rounded-full border py-1 pl-2.5 pr-1.5 font-mono text-[11px] transition-all " +
                            (active ? "border-indigo bg-indigo-bg font-semibold text-indigo" : "border-line bg-white text-ink-soft hover:border-indigo hover:text-indigo")}>
                          {active && <span aria-hidden>✓</span>}
                          <span>{m}</span>
                          <button onClick={e => { e.stopPropagation(); removeCustomModel(m); }} aria-label={`移除模型 ${m}`}
                            className="cursor-pointer border-none bg-transparent px-0.5 text-[13px] leading-none text-ink-faint hover:text-seal">×</button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="flex gap-2">
                  <input value={newModelName} onChange={e => setNewModelName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") submitNewModel(); }}
                    placeholder={apiFormat === "anthropic" ? "如 claude-sonnet-4-6,回车添加" : "如 gpt-4o / deepseek-chat / qwen-max,回车添加"}
                    spellCheck={false} className={inputCls + " flex-1"} />
                  <button onClick={submitNewModel} disabled={!newModelName.trim()}
                    className={btnCls + " shrink-0 rounded-md px-3.5 text-xs"}>
                    + 添加
                  </button>
                </div>
              </div>

              {/* 测试连接:GET /v1/models,连通即列出可用模型,点击直接选用 */}
              <div>
                <div className="flex items-center gap-2.5">
                  <button onClick={testConnection} disabled={testing || !apiHost.trim()}
                    className={btnCls + " rounded-full px-3.5 py-1.5 text-xs"}>
                    {testing ? "测试中…" : "测试连接,拉取模型列表"}
                  </button>
                  {testResult?.ok && (
                    <span className="text-xs text-indigo">✓ 连接成功,{testResult.models.length} 个可用模型</span>
                  )}
                </div>
                {testResult && !testResult.ok && (
                  <div className="mt-2 text-xs leading-relaxed text-seal">{testResult.msg}</div>
                )}
                {testResult?.ok && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {testResult.models.slice(0, 12).map(id => {
                      const added = customModels.includes(id);
                      return (
                        <button key={id} onClick={() => addCustomModel(id)}
                          title={added ? "已在模型列表" : "加入模型列表并设为当前使用"}
                          className={"cursor-pointer rounded-full border px-2.5 py-1 font-mono text-[11px] transition-all " +
                            (added ? "border-indigo bg-indigo-bg text-indigo" : "border-line bg-white text-ink-soft hover:border-indigo hover:text-indigo")}>
                          {added ? "✓ " : "+ "}{id}
                        </button>
                      );
                    })}
                    {testResult.models.length > 12 && (
                      <span className="self-center text-[11px] text-ink-faint">…共 {testResult.models.length} 个,其余可在上方手动添加</span>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-md bg-paper-deep px-2.5 py-2 text-[11px] leading-[1.7] text-ink-faint">
                Host 填服务根地址即可,端点路径会自动拼接;也可直接粘贴完整端点。适用于 API 中转、One-API / New-API 网关、本地 Ollama、vLLM 等 OpenAI 兼容服务。
              </div>
            </div>
          </section>
        )}

        <div className="text-xs text-ink-faint">
          当前生效:{apiMode === "custom"
            ? (customApiModel.trim() ? `自定义接入 · ${customApiModel.trim()}` : "自定义接入 · 尚未填写模型名")
            : `内置 · ${modelSummary}`}
        </div>
      </div>
    </main>
  );
}
