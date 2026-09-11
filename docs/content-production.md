# 内容生产（T15 / #16）

登录后从「创建词条」进入向导，填写标题、简介、别名和关键文本等导航信息。信息框自动保存至浏览器本地，刷新可恢复，提交成功后清除。编者的提案进入审核队列，管理员直接生效。解释正文从词条页「撰写视角」另行创建，并选择具名诠释者。

管理员可从向导下方进入 `/admin/import`，选择文件或粘贴 JSON：

```json
{
  "interpreters": [{ "title": "示例思想家", "summary": "一句话简介" }],
  "terms": [{
    "title": "示例概念",
    "summary": "一句话简介",
    "aliases": ["别名"]
  }]
}
```

每批合计 1–100 项，JSON 最多 1 MB。`title` 必填，`summary` 可省略；词条支持 `aliases`（最多 50 项）和 `keyTexts`（关键文本）。旧 `content` 可省略或填写空字符串；非空正文会明确报错，请另行提交具名视角。同名冲突或非法正文等错误使整批回滚。导入复用直编修订、双链与搜索同步管线；词条和诠释者的首个修订保存信息框快照，视角修订保存 Markdown。请求成功后勿重复提交同一批次；重试撞名会报错，不会追加重复词条。

## R2 配置

迁移：`pnpm db:migrate`。应用服务端配置 `.env.example` 中的 `R2_ENDPOINT`、`R2_BUCKET`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`。端点形如 `https://<account-id>.r2.cloudflarestorage.com`。使用有对象读写权限的令牌，桶保持私有，关闭公共域名与 r2.dev 访问。

在 R2 桶设置 CORS（替换为实际站点源，本地开发可另加 `http://localhost:3000`）：

```json
[{
  "AllowedOrigins": ["https://wiki.example.com"],
  "AllowedMethods": ["PUT", "GET", "HEAD"],
  "AllowedHeaders": ["Content-Type"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3600
}]
```

为 `staging/` 前缀设置一天后删除的生命周期规则，清理暂存及中断上传。不要对 `images/` 设置自动过期：历史修订仍会引用图片。冻结操作后如果数据库提交失败，可能留下无引用对象；不要按创建时间删除，以免破坏仍被引用的图片。

上传按钮申请 5 分钟有效的 PUT 签名，由浏览器直接上传 R2；应用不接收图片字节。完成端点核对对象大小与 Content-Type，再通过 ETag 条件复制到从不签发 PUT 的独立 key，防止上传链接重放修改待审／已受理图片。允许 PNG、JPEG、WebP、GIF，最大 10 MB，不允许 SVG。

正文只接受 `![说明](/api/images/<id>)`，也支持 Markdown 引用式图片。提交和导入拒绝外链图片；读路径和实时预览过滤历史外链图片。编者上传完成后仅本人和管理员可以预览；管理员上传立即公开。编者内容受理时，在修订事务中公开其引用的图片，驳回不公开。公开过的图片保留可读，供历史修订使用。

站内图片端点鉴权后重定向到 60 秒有效的 R2 GET 签名，响应禁止缓存。持有临时 GET 地址者可在有效期内查看图片。审核队列展示提案渲染预览，供管理员一并检查图片和正文。

## 验证

`pnpm test tests/integration/production.test.ts tests/unit/image-markdown.test.ts` 使用真实 PostgreSQL 与 ObjectStore fake。`pnpm test tests/integration/r2-object-store.contract.test.ts` 使用独立测试桶：配置全部 `R2_CONTRACT_*` 变量后验证真实 PUT、HEAD、条件复制和 GET，并清理本次生成的对象。未配置时明确跳过；配置后服务错误会使测试失败。浏览器跨域上传还需核对部署源的 CORS。

实现依据：[Cloudflare R2 预签名 URL](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)、[AWS SDK v3 示例与 CORS](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/)。
