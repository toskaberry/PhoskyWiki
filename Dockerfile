# Exact versions are intentional; updates must rerun the container acceptance job.
FROM node:26.8.2-bookworm-slim@sha256:cd9f682fa2885cd1056e830424764158570061c59736a1da836bc3d73df095ae AS dependencies
WORKDIR /app
RUN npm install --global pnpm@10.30.3
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
ARG APP_REVISION
ENV NEXT_TELEMETRY_DISABLED=1
# better-auth initializes while Next collects routes, even though all database
# pages are dynamic. This disposable value is used only in this build process;
# the runtime stage must load its own protected configuration.
RUN mkdir -p public && test -n "$APP_REVISION" && BETTER_AUTH_SECRET=build-only-placeholder-never-a-runtime-secret BETTER_AUTH_URL=http://build.invalid pnpm build

FROM node:26.8.2-bookworm-slim@sha256:cd9f682fa2885cd1056e830424764158570061c59736a1da836bc3d73df095ae AS runtime
WORKDIR /app
ENV NODE_ENV=production PHOSKYWIKI_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
ARG APP_REVISION
LABEL org.opencontainers.image.revision=$APP_REVISION
ENV APP_REVISION=$APP_REVISION
# Retain the locked tools for migration/bootstrap/reindex (several are devDeps).
# The server still runs only the production build. No package install at startup.
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json /app/tsconfig.json /app/next.config.ts ./
COPY --from=build /app/src ./src
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts
RUN mkdir -p .next/cache && chown -R node:node .next/cache
USER node
EXPOSE 3000
ENTRYPOINT ["node", "scripts/container-entrypoint.mjs"]
CMD ["serve"]
