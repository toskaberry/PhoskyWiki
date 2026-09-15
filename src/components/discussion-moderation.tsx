"use client";

// 页面评论版务控件：锁定覆盖同词条总评论与各视角评论。

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LockDiscussionButton({
  termId,
  locked,
  labels = { lock: "锁定评论", unlock: "解锁评论" },
}: {
  termId: number;
  locked: boolean;
  /** 同一锁定开关在不同入口的措辞 */
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
        title={locked ? "解锁后恢复发言" : "锁定后该词条评论区（含各视角）任何角色（含管理员）不能发言"}
        className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
      >
        {pending ? "…" : locked ? labels.unlock : labels.lock}
      </button>
    </span>
  );
}
