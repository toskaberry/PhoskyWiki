import { hasAdminRole } from "@/lib/roles";
import Link from "next/link";
import { getSessionUser } from "@/lib/session";
import { ImportForm } from "./import-form";

export const dynamic = "force-dynamic";
export default async function ImportPage() {
  const actor = await getSessionUser();
  return <main className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-4 py-8">
    <Link href="/new/term" className="text-sm underline">新建词条</Link>
    <h1 className="text-2xl font-bold">JSON 批量导入</h1>
    {hasAdminRole(actor?.role) ? <ImportForm /> : <p>需要管理员角色才能导入。</p>}
  </main>;
}
