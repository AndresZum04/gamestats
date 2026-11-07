# GameConsole: the server (Fastify) serving the built web console.
# Build from console/:  docker build -t gameconsole-console .
FROM node:20.19.5-alpine3.22 AS build
WORKDIR /app
# Dependencies first, so a change in the code does not reinstall them.
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY web/package.json web/
COPY server/package.json server/
COPY e2e/package.json e2e/
RUN npm ci --include-workspace-root -w shared -w web -w server
COPY shared shared
COPY web web
COPY server server
RUN npm run build

# Only what runs: the compiled server and page, and production dependencies.
FROM node:20.19.5-alpine3.22
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY web/package.json web/
COPY server/package.json server/
COPY e2e/package.json e2e/
RUN npm ci --omit=dev -w server -w shared && npm cache clean --force
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist

# The image's own user without privileges; compose may run it with the
# user that owns the data folder instead.
USER node
ENV PORT=3000 WEB_DIST=/app/web/dist
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=20 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "server/dist/index.js"]
