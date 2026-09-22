import Link from "next/link";
import type { Metadata } from "next";

import { RegisterForm } from "@/components/register-form";
import { authPageHref, safeAuthRedirect } from "@/lib/auth-redirect";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "注册",
  referrer: "no-referrer",
};

export default async function RegisterPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const redirectTo = safeAuthRedirect((await searchParams).redirect);
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16 sm:px-6">
      <header className="border-t-2 border-foreground pt-6">
        <p className="text-xs font-medium tracking-widest text-muted-foreground">账户 · 注册</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">注册成为编者</h1>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          注册后可提交词条与视角的编辑，经审核受理后生效。
        </p>
      </header>
      <RegisterForm redirectTo={redirectTo} />
      <p className="mt-8 border-t border-border pt-4 text-sm text-muted-foreground">
        已有账号？{" "}
        <Link href={authPageHref("login", redirectTo)} className="text-foreground underline-offset-4 hover:underline">
          登录
        </Link>
      </p>
    </main>
  );
}
