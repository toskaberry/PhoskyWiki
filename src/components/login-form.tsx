"use client";

// 登录表单（T05）：better-auth signIn.email，数据库会话写入 httpOnly cookie。

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";

export function LoginForm({ redirectTo = "/" }: { redirectTo?: string | null }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const { data, error } = await authClient.signIn.email({
      email: String(form.get("email") ?? "").trim(),
      password: String(form.get("password") ?? ""),
    });
    if (error || !data) {
      setError(authErrorMessage(error));
      setPending(false);
      return;
    }
    // 带回跳目标（如讨论区 ?perspective= 预填锚点），由登录页做站内路径白名单
    router.push(redirectTo ?? "/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-5" noValidate aria-busy={pending}>
      <label className="flex flex-col gap-2 text-sm font-medium">
        邮箱
        <Input name="email" type="email" required autoComplete="email" className="h-11" disabled={pending} />
      </label>
      <label className="flex flex-col gap-2 text-sm font-medium">
        密码
        <Input name="password" type="password" required autoComplete="current-password" className="h-11" disabled={pending} />
      </label>
      {error && (
        <p data-testid="form-error" role="alert" className="rounded-md border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending} aria-busy={pending} className="h-11 w-full text-base">
        {pending ? "登录中…" : "登录"}
      </Button>
    </form>
  );
}
