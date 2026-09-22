"use client";

// 版务锁定控件：一个词条一行锁定状态，覆盖该词条总评论、各视角评论与感想回复。
// F11：小尺寸描边控件，错误靠近操作；措辞与作用范围保持不变。

import { useRouter } from "next/navigation";
import { useState } from "react";

export function TermLockButton({
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
    const res = await fetch(`/api/admin/terms/${termId}/lock`, {
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
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={pending}
        aria-busy={pending}
        title={locked ? "解锁后恢复发言" : "锁定后该词条评论区（含各视角）任何角色（含管理员）不能发言"}
        className="min-h-8 rounded-md border border-border px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
      >
        {pending ? "…" : locked ? labels.unlock : labels.lock}
      </button>
      {error && (
        <span role="alert" className="text-xs text-destructive [overflow-wrap:anywhere]">
          {error}
        </span>
      )}
    </span>
  );
}
