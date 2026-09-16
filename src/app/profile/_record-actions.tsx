"use client";

// 个人界面的「评论与感想」就地管理（spec 0009 #76）：就地删除记录、切换感想公开性。
// 两个动作都走同一组带 returnTo 的 API，完成后由服务端重定向回当前筛选视图。

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { PersonalRecord } from "@/lib/personal-records";

export function PersonalRecordActions({ record, returnTo }: { record: PersonalRecord; returnTo: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mutate(url: string, init: RequestInit) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(url, init);
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        setError(data?.error ?? "操作失败，请重试");
        return;
      }
      router.refresh();
    } catch {
      setError("网络异常，请重试");
    } finally {
      setPending(false);
    }
  }

  const path = record.kind === "reply" ? `/api/thought-replies/${record.id}` : `/api/thoughts/${record.id}`;
  const scoped = `${path}?returnTo=${encodeURIComponent(returnTo)}`;
  return <span className="flex items-center gap-3">
    {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
    {record.kind === "thought" && record.status === "available" && <button
      type="button"
      disabled={pending}
      onClick={() => void mutate(path, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visibility: record.visibility === "public" ? "private" : "public", returnTo }),
      })}
      className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
    >
      {record.visibility === "public" ? "转为仅自己可见" : "设为公开"}
    </button>}
    <button
      type="button"
      disabled={pending}
      onClick={() => void mutate(record.kind === "comment" ? `/api/comments/${record.id}?returnTo=${encodeURIComponent(returnTo)}` : scoped, { method: "DELETE" })}
      className="text-xs text-muted-foreground underline-offset-4 hover:text-destructive hover:underline disabled:opacity-50"
    >
      {pending ? "处理中…" : "删除"}
    </button>
  </span>;
}
