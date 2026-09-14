"use client";

// 评论下的扁平回复区（spec 0009）：时间升序、@ 提及只是正文前缀文本、不嵌套。
// 点某条回复的「回复」以「回复 @昵称：」前缀开框，指明回应对象；对评论本身的
// 回复不带前缀。移动端只读（无回复/删除入口）；游客可读，写操作引导登录。

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

export interface PageCommentReplyItem {
  id: number;
  content: string;
  createdAt: string;
  authorId: string;
  authorName: string;
  deleted: boolean;
}

async function postReply(url: string, body: object) {
  const response = await fetch(url, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result?.error ?? "操作失败，请重试");
  }
}

function ReplyTime({ createdAt }: { createdAt: string }) {
  return <time dateTime={createdAt} className="text-xs text-muted-foreground">
    {new Date(createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
  </time>;
}

export function PageCommentReplies({ commentId, replies, viewer, replyable, loginRedirect }: {
  commentId: number;
  replies: PageCommentReplyItem[];
  viewer: { id: string; isAdmin: boolean } | null;
  /** 占位评论不可再回复，但其下回复仍可由作者/管理员删除 */
  replyable: boolean;
  loginRedirect: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const canWrite = viewer !== null && replyable;

  function startReply(prefix: string) {
    setContent(prefix); setOpen(true); setError("");
  }

  async function submit() {
    if (pending) return;
    setPending(true); setError("");
    try {
      await postReply(`/api/comments/${commentId}/replies`, { content });
      setContent(""); setOpen(false); router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "网络错误，请重试"); }
    finally { setPending(false); }
  }

  async function remove(id: number) {
    if (pending) return;
    setPending(true); setError("");
    try { await fetch(`/api/replies/${id}`, { method: "DELETE" }).then(async response => {
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "操作失败，请重试");
    }); router.refresh(); }
    catch (error) { setError(error instanceof Error ? error.message : "网络错误，请重试"); }
    finally { setPending(false); }
  }

  return <div className="mt-3">
    {replies.length > 0 && <ul className="flex flex-col gap-3 border-l-2 border-border pl-4">
      {replies.map(reply => <li key={reply.id} className="text-sm">
        {reply.deleted ? <p className="italic text-muted-foreground">该回复已被版务删除。</p> : <>
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium">{reply.authorName}</span>
            <ReplyTime createdAt={reply.createdAt} />
            {viewer && (viewer.id === reply.authorId || viewer.isAdmin) &&
              <span className="hidden md:inline">
                <button type="button" disabled={pending} className="text-xs text-muted-foreground hover:text-destructive"
                  onClick={() => void remove(reply.id)}>{pending ? "删除中…" : "删除回复"}</button>
              </span>}
            {canWrite && <span className="hidden md:inline">
              <button type="button" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                onClick={() => startReply(`回复 @${reply.authorName}：`)}>回复</button>
            </span>}
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed">{reply.content}</p>
        </>}
      </li>)}
    </ul>}
    {canWrite ? <div className="mt-3 hidden md:block">
      {open ? <form onSubmit={event => { event.preventDefault(); void submit(); }}>
        <label htmlFor={`reply-content-${commentId}`} className="sr-only">回复内容</label>
        <textarea id={`reply-content-${commentId}`} value={content} onChange={event => setContent(event.target.value)}
          disabled={pending} rows={3} maxLength={2000} required autoFocus
          className="block w-full rounded-md border border-border bg-background p-3 text-sm"
          placeholder="回复即时公开，仅支持纯文本，最多 2000 字符。" />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">{content.length}/2000</span>
          <span className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={pending}
              onClick={() => { setOpen(false); setContent(""); setError(""); }}>收起</Button>
            <Button type="submit" size="sm" disabled={pending || !content.trim()}>{pending ? "发送中…" : "回复"}</Button>
          </span>
        </div>
        {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
      </form> : <button type="button" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        onClick={() => startReply("")}>回复</button>}
      {error && !open && <p role="alert" className="mt-1 text-sm text-destructive">{error}</p>}
    </div> : !viewer && replyable ? <p className="mt-3 hidden text-sm text-muted-foreground md:block">
      <Link href={loginRedirect} className="text-primary hover:underline">登录</Link>后即可回复。
    </p> : null}
  </div>;
}
