"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

const subscribeHydration = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export function PageAction({ pageId, action, revisionId, deleteTerm }: {
  pageId: number;
  action: "rollback" | "delete" | "restore";
  revisionId?: number;
  deleteTerm?: { title: string; perspectiveCount: number };
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  // GET comparison navigation returns SSR buttons before their click handlers attach.
  const ready = useSyncExternalStore(subscribeHydration, clientReady, serverReady);
  const label = action === "rollback" ? `回滚到修订 #${revisionId}` : action === "delete" ? deleteTerm ? "删除词条" : "软删除页面" : "恢复页面";
  async function apply() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/pages/${pageId}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, revisionId }),
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error ?? "页面操作失败");
      }
      setConfirming(false);
      if (deleteTerm && action === "delete") router.push("/admin/deleted");
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "页面操作失败，请重试");
    } finally {
      setPending(false);
    }
  }
  return <span className="inline-flex flex-col items-start gap-1">
    <Button type="button" variant="outline" size="sm" disabled={!ready || pending} onClick={() => deleteTerm && action === "delete" ? setConfirming(true) : apply()}>{pending ? "处理中…" : label}</Button>
    {confirming && <span role="dialog" aria-label="确认删除词条" className="mt-2 flex max-w-lg flex-col gap-3 rounded-md border border-border bg-card p-4 text-sm">
      <span>删除“{deleteTerm!.title}”后，词条及其 {deleteTerm!.perspectiveCount} 个当前可见视角将对全站隐藏。历史保留，可在管理员回收站恢复。</span>
      <span className="flex gap-2"><Button size="sm" disabled={pending} onClick={apply}>确认删除</Button><Button size="sm" variant="outline" disabled={pending} onClick={() => { setConfirming(false); setError(null); }}>取消</Button></span>
    </span>}
    {error && <span role="alert" className="text-sm text-destructive">{error}</span>}
  </span>;
}
