"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/task-page";

type Grant = { id: string; purpose: "invitation" | "reset"; targetUserId: string | null; expiresAt: string; consumedAt: string | null; revokedAt: string | null };
async function fetchGrants(): Promise<Grant[]> {
  const response = await fetch("/api/admin/access", { cache: "no-store" });
  if (!response.ok) throw new Error("无法读取令牌记录");
  return (await response.json()).grants;
}

function grantState(grant: Grant, loadedAt: number): { label: string; tone: "neutral" | "accent" | "outline" | "warning" } {
  if (grant.revokedAt) return { label: "已撤销", tone: "warning" };
  if (grant.consumedAt) return { label: "已使用", tone: "neutral" };
  if (new Date(grant.expiresAt).getTime() <= loadedAt) return { label: "已过期", tone: "outline" };
  return { label: "待使用", tone: "accent" };
}

// F11：邀请与恢复按「签发 → 一次性链接 → 记录」组织；
// 链接仅显示一次的提示与撤销结果保持既有文案与行为。
export function AccessManager() {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [link, setLink] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [loadedAt, setLoadedAt] = useState(0);
  async function refresh() {
    setGrants(await fetchGrants());
    setLoadedAt(Date.now());
  }
  useEffect(() => {
    let active = true;
    fetchGrants().then(grants => {
      if (active) { setGrants(grants); setLoadedAt(Date.now()); }
    }).catch(() => { if (active) setMessage("无法读取令牌记录"); });
    return () => { active = false; };
  }, []);
  async function act(body: Record<string, unknown>) {
    setPending(true); setMessage(""); setLink("");
    try {
      const response = await fetch("/api/admin/access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
      const data = await response.json();
      if (!response.ok) { setMessage(data.error); return; }
      if (data.token) setLink(`${window.location.origin}/${body.purpose === "invitation" ? "register" : "reset-password"}#${data.token}`);
      setMessage(body.action === "revoke" ? "已撤销" : "链接仅显示这一次，请私下交付。不会自动发送邮件。");
      await refresh();
    } catch { setMessage("操作失败，请刷新记录后重试"); }
    finally { setPending(false); }
  }
  function recover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void act({ action: "issue", purpose: "reset", targetEmail: new FormData(event.currentTarget).get("targetEmail") });
  }
  return <div className="flex flex-col gap-8">
    <section aria-labelledby="access-invite-heading" className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <h2 id="access-invite-heading" className="text-lg font-semibold tracking-tight">邀请编者</h2>
      <p className="mt-1 text-sm text-muted-foreground">生成一次性注册链接；仅显示一次，请私下交付。</p>
      <div className="mt-4">
        <Button disabled={pending} onClick={() => act({ action: "issue", purpose: "invitation" })}>签发编者邀请</Button>
      </div>
    </section>
    <section aria-labelledby="access-recover-heading" className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <h2 id="access-recover-heading" className="text-lg font-semibold tracking-tight">密码恢复</h2>
      <form onSubmit={recover} className="mt-4 flex flex-col gap-4">
        <p className="text-sm leading-relaxed text-muted-foreground">恢复前，通过既有可信渠道人工核实账号本人，并核对目标账号邮箱。这不等同于验证邮箱。</p>
        <label className="flex flex-col gap-2 text-sm font-medium">目标账号邮箱<Input name="targetEmail" type="email" required /></label>
        <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" required className="size-4" /> 已核实目标账号本人身份</label>
        <div><Button disabled={pending} variant="outline">签发密码恢复</Button></div>
      </form>
    </section>
    {message && <p role="status" className="text-sm">{message}</p>}
    {link && <div className="rounded-lg border border-border bg-card p-4">
      <label className="flex flex-col gap-2 text-sm font-medium">一次性链接<Input readOnly value={link} autoComplete="off" onFocus={event => event.target.select()} className="font-mono text-xs" /></label>
      <p className="mt-2 text-xs text-muted-foreground">链接只显示这一次；关闭或刷新后无法再次查看。</p>
    </div>}
    <section aria-labelledby="access-records-heading">
      <h2 id="access-records-heading" className="text-lg font-semibold tracking-tight">最近 100 条签发记录</h2>
      {grants.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">还没有签发记录。</p>
      ) : (
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border">{grants.map(grant => {
          const state = grantState(grant, loadedAt);
          return <li key={grant.id} className="flex flex-col gap-2 break-all p-4" data-testid="grant-record">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <StatusChip>{grant.purpose === "invitation" ? "编者邀请" : "密码恢复"}</StatusChip>
              <StatusChip tone={state.tone}>{state.label}</StatusChip>
              <span className="text-xs text-muted-foreground">有效至 {new Date(grant.expiresAt).toLocaleString()}</span>
            </div>
            <p className="font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">{grant.id}</p>
            {grant.targetUserId && <p className="text-xs text-muted-foreground">目标账号：{grant.targetUserId}</p>}
            {!grant.revokedAt && !grant.consumedAt && <div><Button disabled={pending} variant="outline" size="sm" onClick={() => act({ action: "revoke", id: grant.id })}>撤销</Button></div>}
          </li>;
        })}</ul>
      )}
    </section>
  </div>;
}
