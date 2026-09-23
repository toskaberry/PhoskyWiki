import Link from "next/link";
import type { Metadata } from "next";

import { LoginForm } from "@/components/login-form";
import { authPageHref, safeAuthRedirect } from "@/lib/auth-redirect";

export const metadata: Metadata = {
  title: "登录",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const redirectTo = safeAuthRedirect((await searchParams).redirect);
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16 sm:px-6">
      <header className="border-t-2 border-foreground pt-6">
        <p className="text-xs font-medium tracking-widest text-muted-foreground">账户 · 登录</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">登录</h1>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          未登录也可以浏览全站内容；登录后才能提交编辑。
        </p>
        {redirectTo && (
          <p className="mt-2 text-sm leading-7 text-muted-foreground">
            登录后将回到你刚才要继续的任务。
          </p>
        )}
      </header>
      <LoginForm redirectTo={redirectTo} />
      <div className="mt-8 flex flex-col gap-2 border-t border-border pt-4 text-sm">
        <Link href={authPageHref("reset-password", redirectTo)} className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          忘记密码？联系管理员恢复
        </Link>
        <p className="text-muted-foreground">
          还没有账号？{" "}
          <Link href={authPageHref("register", redirectTo)} className="text-foreground underline-offset-4 hover:underline">
            注册
          </Link>
        </p>
      </div>
    </main>
  );
}
