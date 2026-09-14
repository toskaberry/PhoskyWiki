"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

async function writeComment(url: string, method: "POST" | "DELETE", body?: object) {
  const response = await fetch(url, {
    method, headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result?.error ?? "操作失败，请重试");
  }
}

export function PageCommentComposer({ pageId }: { pageId: number }) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return <form onSubmit={async event => {
    event.preventDefault();
    if (pending) return;
    setPending(true); setError("");
    try {
      await writeComment("/api/comments", "POST", { pageId, content });
      setContent(""); router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "网络错误，请重试"); }
    finally { setPending(false); }
  }}>
    <label htmlFor={`comment-content-${pageId}`} className="text-sm">评论内容</label>
    <textarea id={`comment-content-${pageId}`} value={content} onChange={event => setContent(event.target.value)}
      disabled={pending} rows={4} maxLength={2000} required
      className="mt-2 block w-full rounded-md border border-border bg-background p-3 text-sm"
      placeholder="评论即时公开，仅支持纯文本，最多 2000 字符。" />
    <div className="mt-2 flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{content.length}/2000</span>
      <Button type="submit" disabled={pending || !content.trim()}>{pending ? "发表中…" : "发表评论"}</Button>
    </div>
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
  </form>;
}

export function DeletePageComment({ id }: { id: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return <div className="hidden md:block">
    <button type="button" disabled={pending} className="text-xs text-muted-foreground hover:text-destructive" onClick={async () => {
      if (pending) return;
      setPending(true); setError("");
      try { await writeComment(`/api/comments/${id}`, "DELETE"); router.refresh(); }
      catch (error) { setError(error instanceof Error ? error.message : "网络错误，请重试"); }
      finally { setPending(false); }
    }}>{pending ? "删除中…" : "删除评论"}</button>
    {error && <p role="alert" className="mt-1 text-sm text-destructive">{error}</p>}
  </div>;
}

export function AgreePageComment({ id, agreed }: { id: number; agreed: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return <span className="inline-flex items-center gap-2">
    <button type="button" aria-pressed={agreed} disabled={pending}
      className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
      onClick={async () => {
        if (pending) return;
        setPending(true); setError("");
        try {
          // API 为幂等设定语义：未赞同则 POST 赞同、已赞同则 DELETE 取消
          await writeComment(`/api/comments/${id}/agree`, agreed ? "DELETE" : "POST");
          router.refresh();
        }
        catch (error) { setError(error instanceof Error ? error.message : "网络错误，请重试"); }
        finally { setPending(false); }
      }}>{agreed ? "已赞同" : "赞同"}</button>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </span>;
}
