import Link from "next/link";
import { listUsers } from "@/lib/user-management";
import { roleLabels } from "@/lib/roles";
import { UserRoleEditor } from "@/components/user-role-editor";
import { AccessError } from "@/lib/access-grants";
import { Callout, StatusChip } from "@/components/task-page";

// F11：个人页内的用户管理（仅超级管理员）。查找、分页与权限变更记录共用
// 全站表格样式；行为与权限规则保持不变。
export async function UserManagement({ actorId, query, page }: { actorId: string; query: string; page: string }) {
  let result;
  try { result = await listUsers(actorId, query, page); }
  catch (error) {
    if (error instanceof AccessError) return <Callout tone="danger" role="alert" className="mt-6">{error.message}。<Link href="/profile" className="underline">返回个人页面</Link></Callout>;
    throw error;
  }
  const href = (target: number) => `/profile?${new URLSearchParams({ userQuery: query, userPage: String(target) })}#user-management`;
  return <section id="user-management" aria-labelledby="user-management-heading" className="mt-8 scroll-mt-36">
    <h2 id="user-management-heading" className="border-t border-border pt-6 text-xl font-semibold tracking-tight">用户管理</h2>
    <p className="mt-2 text-sm text-muted-foreground">可任命其他超级管理员。不能降低自己的权限，站点至少保留一位超级管理员。</p>
    <form action="/profile#user-management" className="my-4 flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-sm font-medium">查找用户<input name="userQuery" defaultValue={query} placeholder="名称或邮箱" maxLength={100} className="h-9 rounded-md border border-input bg-background px-3 text-sm font-normal outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" /></label>
      <button className="h-9 rounded-lg border border-input bg-background px-3 text-sm font-medium transition-colors hover:bg-muted" type="submit">查找</button>
    </form>
    <p className="text-sm text-muted-foreground">共 {result.total} 位用户 · 第 {result.page} 页</p>
    <div className="mt-3 overflow-x-auto rounded-lg border border-border"><table className="w-full text-left text-sm">
      <thead><tr className="border-b border-border bg-muted/40"><th className="p-2 font-medium">用户</th><th className="p-2 font-medium">当前权限</th><th className="p-2 font-medium">调整权限</th></tr></thead>
      <tbody>{result.users.map(account => <tr key={account.id} className="border-b border-border last:border-b-0">
        <td className="p-2"><p className="font-medium">{account.name}</p><p className="break-all text-xs text-muted-foreground">{account.email}</p></td>
        <td className="whitespace-nowrap p-2"><StatusChip tone="outline">{roleLabels[account.role]}</StatusChip></td>
        <td className="p-2"><UserRoleEditor userId={account.id} role={account.role} self={account.id === actorId} /></td>
      </tr>)}</tbody>
    </table></div>
    {!result.users.length && <p className="my-4 text-sm text-muted-foreground">没有找到用户。</p>}
    <nav aria-label="用户列表分页" className="mt-3 flex gap-4 text-sm">
      {result.page > 1 && <Link href={href(result.page - 1)} className="underline-offset-4 hover:underline">上一页</Link>}
      {result.page * result.pageSize < result.total && <Link href={href(result.page + 1)} className="underline-offset-4 hover:underline">下一页</Link>}
    </nav>
    {result.changes.length > 0 && <details className="mt-4 text-sm"><summary className="min-h-11 cursor-pointer py-1 text-muted-foreground hover:text-foreground">最近权限变更</summary>
      <ul className="mt-2 space-y-2">{result.changes.map(change => <li key={change.id} className="break-all text-xs text-muted-foreground">
        {change.createdAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} · {change.actorName ?? (change.actorId === "maintenance:initial-superadmin" ? "维护者" : "已删除账号")} 将 {change.targetName ?? "已删除账号"} 从{roleLabels[change.previousRole]}调整为{roleLabels[change.newRole]}
      </li>)}</ul>
    </details>}
  </section>;
}
