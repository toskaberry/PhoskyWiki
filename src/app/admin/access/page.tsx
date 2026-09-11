import { hasAdminRole } from "@/lib/roles";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { AccessManager } from "@/components/access-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "邀请与账号恢复", referrer: "no-referrer" as const };
export default async function AccessPage() {
  const actor = await getSessionUser();
  if (!actor) redirect("/login");
  if (!hasAdminRole(actor.role)) notFound();
  return <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8"><h1 className="mb-6 text-2xl font-bold">邀请与账号恢复</h1><AccessManager /></main>;
}
