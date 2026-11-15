# Build
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# Run
FROM node:22-slim
ENV NODE_ENV=production PORT=8787
WORKDIR /app
RUN useradd --system --uid 10001 weave
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/package.json ./
COPY --from=build /app/assets ./assets
COPY --from=build /app/reference/handoff/reference/weave_research_skill ./reference/handoff/reference/weave_research_skill
USER weave
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Migrations are applied at start-up, under an advisory lock, before the server listens.
CMD ["node", "dist/server/main.js"]
