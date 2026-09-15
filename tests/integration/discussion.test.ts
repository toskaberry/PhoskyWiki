import { expect, it } from "vitest";
import { POST } from "@/app/api/discussion/posts/route";
import { DELETE } from "@/app/api/discussion/posts/[postId]/route";

it("旧讨论新增接口返回退役状态", async () => {
  expect((await POST(new Request("http://localhost/api/discussion/posts", { method: "POST" }))).status).toBe(410);
});
it("旧讨论删除接口返回退役状态", async () => {
  expect((await DELETE(new Request("http://localhost/api/discussion/posts/1", { method: "DELETE" }), { params: Promise.resolve({ postId: "1" }) })).status).toBe(410);
});
