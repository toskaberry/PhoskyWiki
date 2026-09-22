"use client";
import { useState } from "react";

// F11：上传以明确的「处理中」进度条 + 状态文字表达，失败原因靠近上传入口。
export function ImageUpload({ onUploaded }: { onUploaded: (src: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function upload(file: File) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/images", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filename: file.name, size: file.size, contentType: file.type }) });
      const signed = await response.json();
      if (!response.ok) throw new Error(signed.error ?? "无法开始上传");
      const put = await fetch(signed.url, { method: "PUT", headers: signed.headers, body: file, credentials: "omit" });
      if (!put.ok) throw new Error("图片上传失败，请重试");
      const completed = await fetch(`/api/images/${signed.id}`, { method: "POST" });
      const result = await completed.json();
      if (!completed.ok) throw new Error(result.error ?? "无法确认上传");
      onUploaded(result.src);
    } catch (error) { setError(error instanceof Error ? error.message : "图片上传失败"); }
    finally { setBusy(false); }
  }
  return <div className="space-y-2 text-sm">
    <label className={`inline-flex min-h-11 cursor-pointer flex-wrap items-center gap-3 rounded-md border px-3 py-2 transition-colors ${busy ? "border-input bg-muted/40" : "border-input hover:bg-muted"}`}>
      {busy ? "图片上传中…" : "上传并插入图片"}
      <input aria-label="上传并插入图片" type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={busy} className="max-w-full text-xs" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void upload(file); }} />
    </label>
    {busy && (
      <progress aria-hidden="true" className="pw-upload-progress h-1 w-full max-w-md" />
    )}
    <p className="text-xs text-muted-foreground">最多 10 MB。编者的图片随正文一起审核；上传后请填写图片说明。</p>
    {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive [overflow-wrap:anywhere]">{error}</p>}
  </div>;
}
