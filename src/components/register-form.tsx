"use client";

// 先原子兑换邀请创建账号，再经既有认证接口登录。

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";

export function RegisterForm({ redirectTo }: { redirectTo?: string | null }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const credentials = {
      name: String(form.get("name") ?? "").trim(),
      email: String(form.get("email") ?? "").trim(),
      password: String(form.get("password") ?? ""),
    };
    let response: Response;
    try {
      response = await fetch("/api/access/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...credentials, token: String(form.get("token") ?? "").trim() || window.location.hash.slice(1) }), cache: "no-store" });
    } catch {
      setError("网络连接失败，请重试"); setPending(false); return;
    }
    if (!response.ok) {
      setError((await response.json()).error); setPending(false); return;
    }
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    const { data, error } = await authClient.signIn.email(credentials);
    if (error || !data) {
      setError(`账号已创建，请到登录页登录：${authErrorMessage(error)}`);
      setPending(false);
      return;
    }
    router.push(redirectTo ?? "/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-5" noValidate aria-busy={pending}>
      <p className="text-sm leading-7 text-muted-foreground">仅接受管理员邀请。通过邀请链接进入可直接填写下方资料；也可手动粘贴邀请码。</p>
      <label className="flex flex-col gap-2 text-sm font-medium">邀请码<Input name="token" type="password" autoComplete="off" className="h-11" disabled={pending} /></label>
      <label className="flex flex-col gap-2 text-sm font-medium">
        名称
        <Input name="name" type="text" required autoComplete="name" placeholder="站内展示的编者名称" className="h-11" disabled={pending} />
      </label>
      <label className="flex flex-col gap-2 text-sm font-medium">
        邮箱
        <Input name="email" type="email" required autoComplete="email" className="h-11" disabled={pending} />
      </label>
      <label className="flex flex-col gap-2 text-sm font-medium">
        密码（至少 8 位）
        <Input name="password" type="password" required minLength={8} autoComplete="new-password" className="h-11" disabled={pending} />
      </label>
      {error && (
        <p data-testid="form-error" role="alert" className="rounded-md border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending} aria-busy={pending} className="h-11 w-full text-base">
        {pending ? "注册中…" : "注册并登录"}
      </Button>
    </form>
  );
}
