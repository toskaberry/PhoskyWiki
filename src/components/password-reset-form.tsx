"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PasswordResetForm() {
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await fetch("/api/access/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: String(form.get("token") ?? "").trim() || window.location.hash.slice(1), password: form.get("password") }), cache: "no-store" });
      if (!result.ok) { setMessage((await result.json()).error); return; }
      window.history.replaceState(null, "", window.location.pathname);
      setDone(true); setMessage("密码已重设，旧会话已失效。请重新登录。");
    } catch { setMessage("网络连接失败，请重试"); }
    finally { setPending(false); }
  }
  return <form onSubmit={submit} className="mt-8 flex flex-col gap-5" aria-busy={pending}>
    <p className="text-sm leading-7 text-muted-foreground">忘记密码请联系管理员核实身份，取得一次性恢复链接。此过程不代表邮箱已验证。</p>
    {!done && <>
      <label className="flex flex-col gap-2 text-sm font-medium">恢复码<Input name="token" type="password" autoComplete="off" className="h-11" disabled={pending} /></label>
      <label className="flex flex-col gap-2 text-sm font-medium">新密码（8–128 位）<Input name="password" type="password" minLength={8} maxLength={128} required autoComplete="new-password" className="h-11" disabled={pending} /></label>
      {message && <p role="alert" className="rounded-md border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">{message}</p>}
      <Button type="submit" size="lg" disabled={pending} aria-busy={pending} className="h-11 w-full text-base">{pending ? "处理中…" : "重设密码"}</Button>
    </>}
    {done && <p role="status" className="rounded-md border-l-2 border-primary bg-accent px-3 py-2 text-sm text-accent-foreground">{message}</p>}
    <Link href="/login" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">返回登录</Link>
  </form>;
}
