"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { assignableRoles, roleLabels } from "@/lib/roles";
import type { UserRole } from "@/db/schema";

// F11：个人页内的权限调整控件。选择 + 保存 + 结果消息同处一行，
// 当前账号不可自我降级（站点至少保留一位超级管理员）。
export function UserRoleEditor({ userId, role, self }: { userId: string; role: UserRole; self: boolean }) {
  const router = useRouter();
  const initial = role === "trusted" ? "editor" : role;
  // select 用非受控（defaultValue）：慢网络下用户可能在水合完成前已经改动原生控件，
  // 受控 value 会让状态停留在服务端旧值，而 DOM 看起来已选中新角色，「保存权限」
  // 因此长期禁用且提交的仍是旧值。保存一律读取 select 的实时值（#100 组合回归）。
  const selectRef = useRef<HTMLSelectElement>(null);
  const [selected, setSelected] = useState<string>(initial);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // 挂载后把状态对齐到 DOM 实际值，恢复被预水合改动占用的「未修改即禁用」语义。
  useEffect(() => {
    const value = selectRef.current?.value;
    if (value) setSelected(previous => (previous === value ? previous : value));
  }, []);
  async function save() {
    const selectedRole = selectRef.current?.value ?? selected;
    setPending(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, role: selectedRole }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "权限修改失败");
      setMessage("权限已更新");
      router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "权限修改失败，请重试"); }
    finally { setPending(false); }
  }
  return <div className="flex flex-wrap items-center gap-2">
    <select ref={selectRef} aria-label="权限级别" defaultValue={initial} onChange={event => { setSelected(event.target.value); setMessage(""); }} disabled={self || pending} className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50">
      {assignableRoles.map(value => <option key={value} value={value}>{roleLabels[value]}</option>)}
    </select>
    {self ? <span className="text-xs text-muted-foreground">当前账号</span> : <Button size="sm" variant="outline" disabled={pending || selected === role} onClick={save}>{pending ? "保存中…" : "保存权限"}</Button>}
    {message && <span role="status" className="text-sm">{message}</span>}
    {error && <span role="alert" className="text-sm text-destructive [overflow-wrap:anywhere]">{error}</span>}
  </div>;
}
