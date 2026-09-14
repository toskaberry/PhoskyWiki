"use client";

// 讨论区版务控件（T13，仅管理员渲染）：软删楼层、锁定/解锁讨论区。
// 语义在 lib/discussion.ts（软删幂等、锁定后任何角色不能发言）；成功后 router.refresh()。

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeletePostButton({ postId }: { postId: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/discussion/posts/${postId}`, { method: "DELETE" });
    if (res.ok) {
      router.refresh();
      setPending(false);
      return;
    }
    try {
      setError(((await res.json()) as { error?: string }).error ?? "操作失败");
    } catch {
      setError("操作失败");
    }
    setPending(false);
  }

  return (
    <span className="flex shrink-0 items-center gap-2">
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={() => void remove()}
        disabled={pending}
        title="软删除：内容保留，展示为占位"
        className="text-xs text-muted-foreground underline-offset-4 hover:text-destructive hover:underline disabled:opacity-50"
      >
        {pending ? "…" : "删除"}
      </button>
    </span>
  );
}

export function LockDiscussionButton({
  termId,
  locked,
  labels = { lock: "锁定讨论", unlock: "解锁讨论" },
}: {
  termId: number;
  locked: boolean;
  /** 同一锁定开关在不同入口的措辞（讨论区页/评论区各用各的标签） */
  labels?: { lock: string; unlock: string };
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/admin/discussion/${termId}/lock`, {
      method: locked ? "DELETE" : "POST",
    });
    if (res.ok) {
      router.refresh();
      setPending(false);
      return;
    }
    try {
      setError(((await res.json()) as { error?: string }).error ?? "操作失败");
    } catch {
      setError("操作失败");
    }
    setPending(false);
  }

  return (
    <span className="flex items-center gap-2">
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={pending}
        title={locked ? "解锁后恢复发言" : "锁定后该词条讨论区与评论区（含各视角）任何角色（含管理员）不能发言"}
        className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
      >
        {pending ? "…" : locked ? labels.unlock : labels.lock}
      </button>
    </span>
  );
}
