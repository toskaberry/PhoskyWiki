import { PasswordResetForm } from "@/components/password-reset-form";
import { safeAuthRedirect } from "@/lib/auth-redirect";
export const dynamic = "force-dynamic";
export const metadata = { title: "恢复账号", referrer: "no-referrer" as const };
export default async function ResetPasswordPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const redirectTo = safeAuthRedirect((await searchParams).redirect);
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16 sm:px-6">
      <header className="border-t-2 border-foreground pt-6">
        <p className="text-xs font-medium tracking-widest text-muted-foreground">账户 · 恢复</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">恢复账号</h1>
      </header>
      <PasswordResetForm redirectTo={redirectTo} />
    </main>
  );
}
