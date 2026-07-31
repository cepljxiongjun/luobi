import { useState } from "react";
import { useApp } from "../store";
import { MODELS, listModels, isTauri } from "../lib/api";
import { SEARCH_PROVIDERS, SEARCH_FRESHNESS, testSearch } from "../lib/websearch";
import { chipCls, btnCls, inputCls, sectionLabelCls } from "../ui";

// 路径中间省略:头尾信息量最大(盘符 / 最后一级目录名),砍中间
const midEllipsis = (s, max = 46) =>
  !s || s.length <= max ? (s || "") : `${s.slice(0, max - 20)} … ${s.slice(-17)}`;

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
    streamEnabled, setStreamEnabled,
    articlesDir, storageError, storageBusy, migratePending, migrateNote,
    pickArticlesDir, confirmMigrate, resetArticlesDir, openArticlesDir,
    searchProvider, setSearchProvider, searchKey, setSearchKey,
    searchCount, setSearchCount, searchFreshness, setSearchFreshness,
    readerKey, setReaderKey, webEnabled, setWebEnabled, webReady, searchCfg,
  } = useApp();
  const [resetConfirm, setResetConfirm] = useState(false); // 恢复默认存储的两步确认
  const [searchTesting, setSearchTesting] = useState(false);
  const [searchTest, setSearchTest] = useState(null); // {ok, msg}
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

  const testSearchConnection = async () => {
    setSearchTesting(true); setSearchTest(null);
    try {
      const n = await testSearch(searchCfg());
      setSearchTest({ ok: true, msg: `连接成功,返回 ${n} 条结果` });
    } catch (e) {
      setSearchTest({ ok: false, msg: e.message || "连接失败" });
    }
    setSearchTesting(false);
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

        {/* 生成体验 */}
        <section>
          <div className={sectionLabelCls + " mb-2.5"}>生成体验</div>
          <div role="button" tabIndex={0}
            onClick={() => setStreamEnabled(!streamEnabled)}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setStreamEnabled(!streamEnabled); } }}
            className={chipCls(streamEnabled) + " flex items-center gap-2.5 px-3 py-2.5"}>
            <span className={"flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] text-[10px] text-white " +
              (streamEnabled ? "border-[1.5px] border-indigo bg-indigo" : "border-[1.5px] border-ink-faint bg-transparent")}>
              {streamEnabled ? "✓" : ""}
            </span>
            <div className="min-w-0 flex-1">
              <div className={"text-[13px] font-semibold " + (streamEnabled ? "text-indigo" : "text-ink")}>流式输出</div>
              <div className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
                写作时文字逐字落到编辑器,不用干等整篇生成完;服务不支持流式会自动退回一次性返回
              </div>
            </div>
          </div>
        </section>

        {/* 联网搜索:让 AI 写之前先查资料。搜索按次计费,所以和模型一样用户自带 Key */}
        <section>
          <div className={sectionLabelCls + " mb-2.5"}>联网搜索</div>

          <div role="button" tabIndex={0}
            onClick={() => setWebEnabled(!webEnabled)}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setWebEnabled(!webEnabled); } }}
            className={chipCls(webEnabled && webReady) + " flex items-center gap-2.5 px-3 py-2.5"}>
            <span className={"flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] text-[10px] text-white " +
              (webEnabled ? "border-[1.5px] border-indigo bg-indigo" : "border-[1.5px] border-ink-faint bg-transparent")}>
              {webEnabled ? "✓" : ""}
            </span>
            <div className="min-w-0 flex-1">
              <div className={"text-[13px] font-semibold " + (webEnabled && webReady ? "text-indigo" : "text-ink")}>
                写作时联网查资料
              </div>
              <div className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
                开启后落笔/列大纲/图文直出前会先检索一遍,把结果作为事实依据注入;写作页可以看到并挑选具体用了哪几条
              </div>
            </div>
            {webEnabled && !webReady && (
              <span className="shrink-0 rounded-full bg-paper-deep px-2 py-px text-[10px] text-seal">尚未填 Key</span>
            )}
          </div>

          <div className="mt-3 mb-1.5 text-[11px] text-ink-faint">搜索源(自带 Key,按次计费;和模型 Key 是两回事)</div>
          <div className="grid grid-cols-2 gap-2">
            {SEARCH_PROVIDERS.map(p => {
              const active = searchProvider === p.id;
              return (
                <button key={p.id} onClick={() => { setSearchProvider(p.id); setSearchTest(null); }}
                  className={chipCls(active) + " px-3 py-2.5"}>
                  <div className={"text-[13px] font-semibold " + (active ? "text-indigo" : "text-ink")}>{p.name}</div>
                  <div className="mt-0.5 text-[10px] leading-relaxed text-ink-faint">{p.desc}</div>
                </button>
              );
            })}
          </div>

          {searchProvider && (
            <div className="mt-2.5 flex flex-col gap-2.5">
              <div className="rounded-md bg-paper-deep px-2.5 py-2 text-[11px] leading-[1.7] text-ink-faint">
                {SEARCH_PROVIDERS.find(p => p.id === searchProvider)?.hint}
                {" "}申请地址:{SEARCH_PROVIDERS.find(p => p.id === searchProvider)?.site}
              </div>
              <div>
                <div className="mb-1.5 text-[11px] text-ink-faint">搜索 API Key(保存在本机,不会上传)</div>
                <input value={searchKey} onChange={e => { setSearchKey(e.target.value); setSearchTest(null); }}
                  type="password" placeholder="sk-…" autoComplete="off" spellCheck={false} className={inputCls} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="mb-1.5 text-[11px] text-ink-faint">每次取几条</div>
                  <div className="flex gap-1.5">
                    {[3, 5, 8].map(n => (
                      <button key={n} onClick={() => setSearchCount(n)}
                        className={"flex-1 cursor-pointer rounded-md border py-1.5 text-center text-xs transition-all " +
                          (searchCount === n ? "border-indigo bg-indigo-bg font-semibold text-indigo" : "border-line bg-white text-ink-soft hover:border-indigo")}>
                        {n} 条
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-1.5 text-[11px] text-ink-faint">时间范围</div>
                  <select value={searchFreshness} onChange={e => setSearchFreshness(e.target.value)}
                    className="box-border w-full cursor-pointer rounded-md border border-line bg-white px-2.5 py-[7px] font-sans text-xs text-ink">
                    {SEARCH_FRESHNESS.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2.5">
                  <button onClick={testSearchConnection} disabled={searchTesting || !searchKey.trim()}
                    className={btnCls + " rounded-full px-3.5 py-1.5 text-xs"}>
                    {searchTesting ? "测试中…" : "测试搜索连接"}
                  </button>
                  {searchTest?.ok && <span className="text-xs text-indigo">✓ {searchTest.msg}</span>}
                </div>
                {searchTest && !searchTest.ok && (
                  <div className="mt-2 text-xs leading-relaxed text-seal">{searchTest.msg}</div>
                )}
              </div>

              <div>
                <div className="mb-1.5 text-[11px] text-ink-faint">
                  网页抓取 Key(可选):抓链接正文用的是 Jina Reader,免 Key 就能用(20 次/分钟),填了提到 200 次/分钟
                </div>
                <input value={readerKey} onChange={e => setReaderKey(e.target.value)} type="password"
                  placeholder="jina_…(留空即可)" autoComplete="off" spellCheck={false} className={inputCls} />
              </div>
            </div>
          )}

          <div className="mt-2 rounded-md bg-paper-deep px-2.5 py-2 text-[11px] leading-[1.7] text-ink-faint">
            {isTauri
              ? "桌面端走原生请求,不受浏览器跨域限制。"
              : "浏览器生产环境直连搜索服务需要对方允许跨域(CORS),开发模式经本地代理转发不受影响;桌面端无此限制。"}
            {" 检索到的资料只在本次会话内有效,刷新即清空;换写法/精简/润色/起标题不会注入资料——那几个操作面对的是已经写好的正文。"}
          </div>
        </section>

        {/* 文章存储:桌面端可把文库指到任意文件夹,每篇一个 .md */}
        <section>
          <div className={sectionLabelCls + " mb-2.5"}>文章存储</div>

          <div className={chipCls(!!articlesDir) + " cursor-default px-3 py-2.5"}>
            <div className="flex items-baseline gap-2">
              <div className={"text-[13px] font-semibold " + (articlesDir ? "text-indigo" : "text-ink")}>
                {articlesDir ? "自选文件夹" : "应用内部存储(默认)"}
              </div>
              {!isTauri && (
                <span className="rounded-full bg-paper-deep px-2 py-px text-[10px] text-ink-faint">仅桌面端可用</span>
              )}
            </div>

            {/* 路径可能很长:中间省略,完整路径挂 title 悬停可见 */}
            <div className="mt-1 font-mono text-[11px] break-all text-ink-soft" title={articlesDir || undefined}>
              {articlesDir ? midEllipsis(articlesDir) : "文章存在本机应用数据目录里"}
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <button onClick={pickArticlesDir} disabled={!isTauri || storageBusy}
                className={btnCls + " rounded-full px-3 py-1 text-xs"}>
                {articlesDir ? "换个文件夹…" : "选择文件夹…"}
              </button>
              <button onClick={openArticlesDir} disabled={!isTauri || !articlesDir || storageBusy}
                className={btnCls + " rounded-full px-3 py-1 text-xs"}>
                打开文件夹
              </button>
              {articlesDir && (resetConfirm ? (
                <button onClick={() => { resetArticlesDir(); setResetConfirm(false); }}
                  onBlur={() => setResetConfirm(false)}
                  className="cursor-pointer rounded-full border border-ink bg-ink px-3 py-1 text-xs text-white transition-opacity hover:opacity-80">
                  确认恢复?文件不会被删除
                </button>
              ) : (
                <button onClick={() => setResetConfirm(true)} disabled={storageBusy}
                  className={btnCls + " rounded-full px-3 py-1 text-xs"}>
                  恢复默认存储
                </button>
              ))}
            </div>

            {/* 迁移确认:内联两步式,与文章库删除同一范式,不弹 window.confirm */}
            {migratePending && (
              <div className="mt-2.5 rounded-md bg-paper-deep px-2.5 py-2 text-[11px] leading-[1.7] text-ink-soft">
                这个文件夹里已有 {migratePending.existing} 篇。把当前的 {migratePending.mine.length} 篇也复制过去吗?
                <div className="mt-1.5 flex gap-2">
                  <button onClick={() => confirmMigrate(true)} className={btnCls + " rounded-full px-3 py-1 text-xs"}>
                    复制过去
                  </button>
                  <button onClick={() => confirmMigrate(false)} className={btnCls + " rounded-full px-3 py-1 text-xs"}>
                    只用文件夹里已有的
                  </button>
                </div>
              </div>
            )}

            {migrateNote && <div className="mt-2 text-[11px] text-ink-faint">{migrateNote}</div>}
            {storageError && <div className="mt-2 text-[11px] leading-relaxed text-seal">{storageError}</div>}
          </div>

          <div className="mt-2 rounded-md bg-paper-deep px-2.5 py-2 text-[11px] leading-[1.7] text-ink-faint">
            {isTauri
              ? "选定后,每篇文章会存成一个 .md 文件(frontmatter 记标题/平台/语气),可以直接用 Obsidian 等编辑器打开,也能放进网盘目录同步。"
              : "浏览器版本拿不到本机路径,文章存在浏览器本地存储里;想把文章落成文件请用桌面端。"}
          </div>
        </section>

        <div className="text-xs text-ink-faint">
          当前生效:{apiMode === "custom"
            ? (customApiModel.trim() ? `自定义接入 · ${customApiModel.trim()}` : "自定义接入 · 尚未填写模型名")
            : `内置 · ${modelSummary}`}
        </div>
      </div>
    </main>
  );
}
