// better-auth 服务端实例（T05）：邮箱密码 + 数据库会话。
// 表结构在 src/db/schema.ts（user/session/account/verification），角色枚举 user_role。
// 密钥读 BETTER_AUTH_SECRET、baseURL 读 BETTER_AUTH_URL（见 .env.example）。

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { verifyPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { account, session, user, verification } from "@/db/schema";
import { CREDENTIAL_ISSUER } from "@/lib/credential";

export const auth = betterAuth({
  database: drizzleAdapter(getDb(), {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 8,
  },
  databaseHooks: {
    session: {
      create: {
        after: async (created, context) => {
          if (context?.path !== "/sign-in/email") return;
          // The session exists, but Better Auth has not returned its cookie yet.
          // FOR SHARE waits for an in-flight reset's credential UPDATE to commit.
          // A later reset necessarily sees this session and deletes it; an earlier
          // reset changes the hash and we reject this stale-password login here.
          const [credential] = await getDb().select({ password: account.password }).from(account)
            .where(and(eq(account.userId, created.userId), eq(account.providerId, "credential"), eq(account.issuer, CREDENTIAL_ISSUER), eq(account.accountId, created.userId))).for("share");
          if (!credential?.password || typeof context.body?.password !== "string" || !await verifyPassword({ hash: credential.password, password: context.body.password })) {
            await getDb().delete(session).where(eq(session.id, created.id));
            throw new APIError("UNAUTHORIZED", { code: "INVALID_EMAIL_OR_PASSWORD", message: "邮箱或密码错误" });
          }
        },
      },
    },
  },
  user: {
    additionalFields: {
      // 角色只能由服务端/种子写入，注册请求携带 role 一律忽略
      role: {
        type: "string",
        required: true,
        defaultValue: "editor",
        input: false,
      },
    },
  },
  session: {
    // Role changes apply to the next request, including existing sessions.
    cookieCache: { enabled: false },
    // 数据库会话默认 30 天有效，滚动续期——「会话持久」的验收口径
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  advanced: {
    // better-auth 在测试环境默认跳过来源检查（isTest()）——显式关掉跳过，
    // 让 dev/test/prod 的 CSRF 姿态一致，也让下面的 trustedOrigins 有意义。
    disableOriginCheck: false,
  },
  // dev/test 额外信任任意本地端口：e2e 用 PW_PORT 可把应用起在 3000 之外的
  // 端口，而 BETTER_AUTH_URL 固定 3000——没有这两条，非 3000 端口登录一律 403。
  // 生产保持只信 BETTER_AUTH_URL（部署若需多域名用 BETTER_AUTH_TRUSTED_ORIGINS）。
  ...(process.env.NODE_ENV === "production"
    ? {}
    : {
        trustedOrigins: [
          "http://localhost:*",
          "http://127.0.0.1:*",
          "http://localhost",
          "http://127.0.0.1",
        ],
      }),
});

export type Session = typeof auth.$Infer.Session;
