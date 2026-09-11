import { createServer } from "node:http";
import { expect, test, type Page } from "./fixtures";

// Guest-only cross-origin streaming fixture must not send proxy headers to the
// external model endpoint (whose deliberate CORS policy permits only API fields).
test.beforeEach(async ({ context }) => { await context.setExtraHTTPHeaders({}); });

async function configure(page: Page, endpoint: string) {
  const panel = page.getByRole("complementary", { name: "Agent 解读" });
  await panel.getByText("模型配置", { exact: true }).click();
  await panel.getByLabel("baseURL").fill(endpoint);
  await panel.getByLabel("API key").fill("test-agent-secret");
  await panel.getByLabel("模型名").fill("test-model");
  await panel.getByRole("button", { name: "保存配置" }).click();
  return panel;
}

test("游客保存本地配置，直连端点并在流结束前看到回答与可点击引用", async ({ page, baseURL }) => {
  let payload: { model: string; stream: boolean; messages: { content: string }[] } | undefined;
  let authorization: string | undefined;
  let finish = () => {};
  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
    if (req.method === "OPTIONS") { res.end(); return; }
    expect(req.url).toBe("/v1/chat/completions");
    authorization = req.headers.authorization;
    let body = "";
    for await (const chunk of req) body += chunk;
    payload = JSON.parse(body);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    // 刻意把 UTF-8 字符和 SSE 事件边界拆开。
    const event = Buffer.from('data: {"choices":[{"delta":{"content":"主体性取决于关系 [1]"}}]}\r\n\r\n');
    const split = event.indexOf(Buffer.from("主")) + 1;
    res.write(event.subarray(0, split));
    setTimeout(() => res.write(event.subarray(split)), 30);
    finish = () => res.end('data: {"choices":[{"delta":{"content":"。"}}]}\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing port");
  const endpoint = `http://127.0.0.1:${address.port}/v1`;
  const siteLeaks: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin === new URL(baseURL!).origin &&
      `${request.url()} ${JSON.stringify(request.headers())} ${request.postData()}`.includes("test-agent-secret")) {
      siteLeaks.push(request.url());
    }
  });
  try {
    await page.goto("/");
    await page.getByRole("link", { name: "主体性", exact: true }).click();
    const panel = await configure(page, endpoint);
    await page.reload();
    await panel.getByLabel("问题").fill("如何理解主体性？");
    await panel.getByRole("button", { name: "发送问题" }).click();
    await expect(panel.getByTestId("agent-answer")).toContainText("主体性取决于关系");
    await expect(panel.getByRole("button", { name: "停止生成" })).toBeVisible();
    expect(authorization).toBe("Bearer test-agent-secret");
    expect(payload).toMatchObject({ model: "test-model", stream: true });
    expect(payload!.messages.map((m) => m.content).join("\n")).toContain("拉康论主体性");
    finish();
    await expect(panel.getByRole("button", { name: "停止生成" })).toHaveCount(0);
    const citation = panel.getByTestId("agent-answer").getByRole("link", { name: "[1]" });
    await expect(citation).toHaveAttribute("href", /\/term\//);
    await Promise.all([page.waitForEvent("load"), citation.click()]);
    await expect(page.getByRole("heading", { level: 1, name: "主体性" })).toBeVisible();
    await panel.getByLabel("问题").fill("再解释一次");
    await panel.getByRole("button", { name: "发送问题" }).click();
    await expect(panel.getByTestId("agent-answer")).toContainText("主体性取决于关系");
    await panel.getByRole("button", { name: "停止生成" }).click();
    await expect(panel.getByRole("status")).toContainText("已停止");
    await expect(panel.getByTestId("agent-answer")).toContainText("主体性取决于关系");
    await panel.getByText("模型配置", { exact: true }).click();
    await panel.getByRole("button", { name: "清除配置" }).click();
    await page.reload();
    await panel.getByText("模型配置", { exact: true }).click();
    await expect(panel.getByLabel("API key")).toHaveValue("");
    expect(siteLeaks).toEqual([]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("视角页生成有序跨词条阅读路径，引用可跳到视角且未知编号不变为链接", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "主体性", exact: true }).click();
  await page.getByRole("link", { name: "拉康论主体性", exact: true }).click();
  await expect(page).toHaveURL(/\/perspective\//);
  const panel = await configure(page, "https://model.example/v1/");
  let nextTitle = "", perspectiveURL = "";
  await page.route("https://model.example/v1/chat/completions", async (route) => {
    const body = route.request().postDataJSON();
    const sources: { citation: number; type: string; url: string; title: string }[] = JSON.parse(body.messages[1].content.split("\n").slice(1).join("\n"));
    const next = sources.find((s) => s.type === "term" && s.citation !== 1)!;
    const perspective = sources.find((s) => s.type === "perspective")!;
    nextTitle = next.title; perspectiveURL = perspective.url;
    const content = `1. [1] 从当前词条入门\n2. [${next.citation}] 理解相关概念\n参照 [${perspective.citation}]，未知 [99999] <img src=x onerror=alert(1)>`;
    await route.fulfill({ contentType: "text/event-stream", body: `: keepalive\n\ndata: ${JSON.stringify({ choices: [{ delta: { role: "assistant" } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n` });
  });
  await panel.getByRole("button", { name: "生成阅读路径" }).click();
  const path = panel.getByRole("region", { name: "阅读路径" });
  await expect(path.getByRole("listitem")).toHaveCount(2);
  await expect(path.getByRole("link").nth(0)).toHaveText("主体性");
  await expect(path.getByRole("link").nth(1)).toHaveText(nextTitle);
  await expect(panel.getByTestId("agent-answer").getByRole("link", { name: "[99999]" })).toHaveCount(0);
  await expect(panel.locator("img")).toHaveCount(0);
  await panel.getByTestId("agent-answer").locator(`a[href="${perspectiveURL}"]`).click();
  await expect(page).toHaveURL(new RegExp(encodeURI(perspectiveURL).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("模型错误和非 SSE 响应可重试，同源端点不能保存密钥", async ({ page, baseURL }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "主体性", exact: true }).click();
  const panel = await configure(page, baseURL!);
  await expect(panel.getByRole("alert")).toContainText("独立的模型端点");
  await panel.getByLabel("baseURL").fill("https://model.example/v1");
  await panel.getByRole("button", { name: "保存配置" }).click();
  await panel.getByLabel("问题").fill("解释主体性");
  await page.route("https://model.example/v1/chat/completions", (route) => route.fulfill({ status: 401, body: "echo test-agent-secret" }));
  await panel.getByRole("button", { name: "发送问题" }).click();
  await expect(panel.getByRole("alert")).toContainText("HTTP 401");
  await expect(panel.getByRole("alert")).not.toContainText("test-agent-secret");
  await page.unroute("https://model.example/v1/chat/completions");
  await page.route("https://model.example/v1/chat/completions", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await panel.getByRole("button", { name: "发送问题" }).click();
  await expect(panel.getByRole("alert")).toContainText("没有返回 SSE");
  await page.unroute("https://model.example/v1/chat/completions");
  await page.route("https://model.example/v1/chat/completions", (route) => route.fulfill({ contentType: "text/event-stream", body: 'data: {"choices":[{"delta":{"content":"部分回答"}}]}\n\n' }));
  await panel.getByRole("button", { name: "发送问题" }).click();
  await expect(panel.getByRole("alert")).toContainText("连接提前结束");
  await expect(panel.getByTestId("agent-answer")).toHaveText("部分回答");
});
