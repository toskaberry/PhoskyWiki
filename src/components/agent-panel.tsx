"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { streamAgentAnswer, validateAgentConfig, type AgentMode } from "@/lib/agent/client";
import { parseAgentConfig, readAgentConfig, saveAgentConfig, serverAgentConfig, subscribeAgentConfig } from "@/lib/agent/config-store";
import type { AgentContext, AgentSource } from "@/lib/agent/types";

/** 模型只产生文本，可信引用地址由只读内容 API 回填；不把模型输出注入 HTML。 */
function CitedText({ text, sources }: { text: string; sources: AgentSource[] }) {
  return text.split(/(\[\d+\])/g).map((part, index) => {
    const match = /^\[(\d+)\]$/.exec(part);
    const source = match ? sources[Number(match[1]) - 1] : undefined;
    return source ? <a key={index} href={source.url} title={source.title} className="underline underline-offset-4">{part}</a> : part;
  });
}

export function AgentPanel({ termId, heading = true }: { termId: number; heading?: boolean }) {
  const rawConfig = useSyncExternalStore(subscribeAgentConfig, readAgentConfig, serverAgentConfig);
  const config = parseAgentConfig(rawConfig);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [context, setContext] = useState<AgentContext | null>(null);
  const [mode, setMode] = useState<AgentMode>("question");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); }, []);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const checked = validateAgentConfig({ baseURL: String(data.get("baseURL")), key: String(data.get("key")), model: String(data.get("model")) }, window.location.origin);
      saveAgentConfig(checked);
      setError("");
      setStatus("配置已保存到此浏览器。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法保存，请检查浏览器是否允许本地存储。");
    }
  }

  async function generate(nextMode: AgentMode) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true); setError(""); setAnswer(""); setContext(null); setMode(nextMode);
    setStatus("正在读取当前词条与一跳邻居…");
    try {
      const checked = validateAgentConfig(config, window.location.origin);
      const response = await fetch(`/api/agent/context?termId=${termId}`, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error("无法读取词条上下文，请刷新页面后重试。");
      const sourceContext: AgentContext = await response.json();
      setContext(sourceContext);
      setStatus("正在生成…");
      await streamAgentAnswer(checked, sourceContext, question.trim(), nextMode, (text) => setAnswer((previous) => previous + text), controller.signal);
      setStatus("生成完成。请结合引用原文核对解读。");
    } catch (cause) {
      if (controller.signal.aborted) setStatus("已停止，保留收到的内容。");
      else {
        setStatus("");
        setError(cause instanceof TypeError ? "无法连接模型端点，请检查网络、baseURL 及端点的 CORS 设置。" : cause instanceof Error ? cause.message : "生成失败，请重试。");
      }
    } finally {
      active.current = null; setBusy(false);
    }
  }

  const sources = context?.sources ?? [];
  const steps = mode === "reading-path" ? answer.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*\d+[.)、]\s*\[(\d+)\]\s*(.*)$/.exec(line);
    const source = match ? sources[Number(match[1]) - 1] : undefined;
    return source?.type === "term" ? [{ source, reason: match![2] }] : [];
  }).filter((step, index, all) => all.findIndex((other) => other.source.id === step.source.id) === index) : [];

  return (
    <aside aria-label="Agent 解读" className="mt-6 min-w-0 rounded-lg border border-border bg-card p-4 text-sm">
      {heading && <h2 className="text-lg font-semibold">Agent 解读</h2>}
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">游客亦可使用。配置仅存此浏览器；问题和当前词条及一跳邻居正文直发你的模型端点。</p>
      <details className="mt-4">
        <summary className="cursor-pointer font-medium">模型配置</summary>
        <form key={rawConfig} onSubmit={save} className="mt-3 space-y-3">
          <label className="block">baseURL<Input name="baseURL" defaultValue={config.baseURL} placeholder="https://端点地址/v1" required disabled={busy} autoComplete="off" /></label>
          <label className="block">API key<Input name="key" type="password" defaultValue={config.key} required disabled={busy} autoComplete="off" /></label>
          <label className="block">模型名<Input name="model" defaultValue={config.model} required disabled={busy} autoComplete="off" /></label>
          <p className="text-xs text-muted-foreground">端点需支持浏览器跨域请求（CORS）和流式 Chat Completions。</p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={busy}>保存配置</Button>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => {
              try { saveAgentConfig(null); setStatus("本地配置已清除。"); setError(""); }
              catch { setError("无法清除，请检查浏览器本地存储权限。"); }
            }}>清除配置</Button>
          </div>
        </form>
      </details>
      <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); void generate("question"); }}>
        <label className="block">问题<textarea value={question} onChange={(event) => setQuestion(event.target.value)} disabled={busy} rows={3} maxLength={4000} placeholder="想理解什么？也可填写阅读目标。" className="mt-1 w-full rounded-md border border-input bg-background p-2" /></label>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" type="submit" disabled={busy || !question.trim()}>发送问题</Button>
          <Button size="sm" variant="outline" type="button" disabled={busy} onClick={() => void generate("reading-path")}>生成阅读路径</Button>
          {busy && <Button size="sm" variant="outline" type="button" onClick={() => active.current?.abort()}>停止生成</Button>}
        </div>
      </form>
      <p role="status" className="mt-3 text-xs text-muted-foreground">{status}</p>
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      {context && <p className="mt-2 text-xs text-muted-foreground">依据 {sources.filter((s) => s.type === "term").length} 个词条、{sources.filter((s) => s.type === "perspective").length} 个视角。</p>}
      {answer && <div data-testid="agent-answer" className="mt-4 whitespace-pre-wrap break-words leading-relaxed"><CitedText text={answer} sources={sources} /></div>}
      {steps.length > 0 && <section aria-label="阅读路径" className="mt-4">
        <h3 className="font-medium">阅读路径</h3>
        <ol className="mt-2 list-decimal space-y-2 pl-5">{steps.map(({ source, reason }) => <li key={source.id}>
          <a href={source.url} className="underline underline-offset-4">{source.title}</a>{reason && <p><CitedText text={reason} sources={sources} /></p>}
        </li>)}</ol>
      </section>}
      {mode === "reading-path" && answer && !busy && steps.length === 0 && <p className="mt-2 text-xs text-muted-foreground">模型未返回可识别的阅读步骤，请重试；原始回答已保留。</p>}
    </aside>
  );
}
