"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

const subscribeHydration = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

// F11：回滚／软删除／恢复的操作按钮。危险操作（删除词条）内联确认面板，
// 结果与错误靠近操作；语义（新修订、可恢复）保持不变。
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
  return <span className="inline-flex flex-col items-start gap-2">
    <Button type="button" variant="outline" size="sm" disabled={!ready || pending} onClick={() => deleteTerm && action === "delete" ? setConfirming(true) : apply()}>{pending ? "处理中…" : label}</Button>
    {confirming && <span role="dialog" aria-label="确认删除词条" className="flex max-w-lg flex-col gap-3 rounded-lg border border-destructive/40 bg-card p-4 text-sm">
      <span>删除“{deleteTerm!.title}”后，词条及其 {deleteTerm!.perspectiveCount} 个当前可见视角将对全站隐藏。历史保留，可在管理员回收站恢复。</span>
      <span className="flex flex-wrap gap-2"><Button size="sm" variant="destructive" disabled={pending} onClick={apply}>确认删除</Button><Button size="sm" variant="outline" disabled={pending} onClick={() => { setConfirming(false); setError(null); }}>取消</Button></span>
    </span>}
    {error && <span role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive [overflow-wrap:anywhere]">{error}</span>}
  </span>;
}
