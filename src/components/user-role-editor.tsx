"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { assignableRoles, roleLabels } from "@/lib/roles";
import type { UserRole } from "@/db/schema";

export function UserRoleEditor({ userId, role, self }: { userId: string; role: UserRole; self: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string>(role === "trusted" ? "editor" : role);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function save() {
    setPending(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, role: selected }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "权限修改失败");
      setMessage("权限已更新");
      router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "权限修改失败，请重试"); }
    finally { setPending(false); }
  }
  return <div className="flex flex-wrap items-center gap-2">
    <select aria-label="权限级别" value={selected} onChange={event => { setSelected(event.target.value); setMessage(""); }} disabled={self || pending} className="rounded-md border border-border bg-background p-2 text-sm">
      {assignableRoles.map(value => <option key={value} value={value}>{roleLabels[value]}</option>)}
    </select>
    {self ? <span className="text-xs text-muted-foreground">当前账号</span> : <Button size="sm" variant="outline" disabled={pending || selected === role} onClick={save}>{pending ? "保存中…" : "保存权限"}</Button>}
    {message && <span role="status" className="text-sm">{message}</span>}
    {error && <span role="alert" className="text-sm text-destructive">{error}</span>}
  </div>;
}
