"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { NOTIFICATIONS_CHANGED } from "@/components/notification-link";

export function MarkNotificationRead({ submissionId }: { submissionId: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function markRead() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/notifications/${submissionId}/read`, { method: "POST" });
      if (!response.ok) {
        setError("标记失败，请稍后再试。");
        return;
      }
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
      router.refresh();
    } catch {
      setError("标记失败，请检查网络后再试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" className="min-h-9" disabled={pending} aria-busy={pending} onClick={markRead}>
        {pending ? "标记中…" : "标为已读"}
      </Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
