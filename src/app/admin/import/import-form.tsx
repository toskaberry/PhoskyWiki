"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";

const example = JSON.stringify({ interpreters: [{ title: "示例诠释者", summary: "一句话简介" }], terms: [{ title: "示例词条", summary: "一句话简介", aliases: ["别名"] }] }, null, 2);

// F11：导入任务以「输入 → 校验 → 结果」表达；失败原因靠近提交操作。
export function ImportForm() {
  const [source, setSource] = useState(example);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ pageId: number; href: string }[] | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      JSON.parse(source);
      const response = await fetch("/api/admin/import", { method: "POST", headers: { "content-type": "application/json" }, body: source });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "导入失败");
      setResult(data.pages);
    } catch (error) { setError(error instanceof Error ? error.message : "导入失败"); }
    finally { setBusy(false); }
  }
  if (result) return <div role="status" className="rounded-lg border border-border bg-card p-6 text-sm">
    <p className="font-medium">已导入 {result.length} 个词条与诠释者，并生成修订记录。</p>
    <ul className="mt-3 flex list-disc flex-col gap-1 pl-5">{result.map((p) => <li key={p.pageId} className="break-all"><Link className="text-primary underline underline-offset-4" href={p.href}>{decodeURIComponent(p.href)}</Link></li>)}</ul>
  </div>;
  return <form onSubmit={submit} className="space-y-5">
    <p className="text-sm leading-relaxed text-muted-foreground">每批 1–100 项，最多 1 MB。按示例填写 terms 与 interpreters；词条只接受导航信息，正文请另行提交具名诠释者视角。整批成功后直接发布，任何一项失败均不保存。</p>
    <label className="block text-sm font-medium">选择 JSON 文件<input className="mt-2 block max-w-full text-sm" type="file" accept=".json,application/json" disabled={busy} onChange={async (e) => {
      const file = e.target.files?.[0]; if (!file) return;
      if (file.size > 1_000_000) { setError("文件不能超过 1 MB"); return; }
      try { setSource(await file.text()); setError(""); } catch { setError("文件读取失败"); }
    }} /></label>
    <label className="block text-sm font-medium">导入 JSON<textarea aria-label="导入 JSON" className="mt-2 min-h-96 w-full rounded-md border border-input bg-background p-3 font-mono text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" value={source} onChange={(e) => setSource(e.target.value)} disabled={busy} spellCheck={false} /></label>
    {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive [overflow-wrap:anywhere]">{error}</p>}
    <Button disabled={busy} type="submit" size="lg">{busy ? "导入中…" : "导入并直接发布"}</Button>
  </form>;
}
