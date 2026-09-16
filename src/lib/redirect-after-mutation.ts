// 写操作后的返回位置（spec 0009「登录后带回跳位置」的同族需求）：个人界面就地删除/切换
// 可见性后回到原筛选视图。只接受站内绝对路径，避免开放重定向。

const SAFE_RETURN_TO = /^\/(?!\/)[\w\-./?=&%#]*$/u;

/** 从 `?returnTo=` 读回跳目标；不合法一律忽略（调用端退回默认行为）。 */
export function returnToFrom(request: Request): string | null {
  const value = new URL(request.url).searchParams.get("returnTo");
  return value && SAFE_RETURN_TO.test(value) ? value : null;
}

/**
 * 成功响应的收敛写法：有合法回跳目标时 303 跳回去（浏览器与表单友好），
 * 否则原样返回 204，让客户端自行刷新（个人界面的 fetch + router.refresh 路径）。
 */
export function afterMutation(request: Request, status: 204 | 201 = 204): Response {
  const returnTo = returnToFrom(request);
  if (returnTo) {
    return new Response(null, { status: 303, headers: { location: returnTo } });
  }
  return new Response(null, { status });
}
