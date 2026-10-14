# syntax=docker/dockerfile:1

# Multi-stage so the runtime image carries no dev dependencies, no client build
# toolchain and no sources it does not need.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig*.json vite.config.ts ./
COPY server ./server
COPY client ./client
# shared/ holds the seeded PRNG, which server and client must agree on exactly.
COPY shared ./shared
# Typecheck in the image, not only on the developer's machine: a build that would
# not compile must not become a running container.
RUN npx tsc -p tsconfig.server.json --noEmit && npx tsc -p tsconfig.client.json --noEmit
RUN npx vite build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# tini gives us a real init so SIGTERM reaches Node rather than being swallowed by
# PID 1. That matters here more than usual: the recorder buffers, and SPEC §3.5's
# shutdown flush is what stops `docker stop` losing the most recent records.
RUN apk add --no-cache tini
COPY package.json package-lock.json ./
# tsx is a real runtime dependency (in `dependencies`, not `devDependencies`): the
# server executes TypeScript directly, which keeps one build path instead of two.
# It was a devDependency at first, so `--omit=dev` left it out and the container
# restart-looped with "exec ./node_modules/.bin/tsx failed".
RUN npm ci --omit=dev && npm cache clean --force
COPY tsconfig*.json ./
COPY server ./server
COPY shared ./shared
COPY config ./config
COPY --from=build /app/dist/client ./dist/client

# Never run as root. The recordings volume is chowned in compose.
USER node
EXPOSE 8080
# No HEALTHCHECK that restarts on failure: /healthz goes 503 when a source is down,
# and a source being down is not a reason to throw away the process and its open
# recording files. External monitoring (§11.3) watches /healthz instead.
ENTRYPOINT ["/sbin/tini", "--"]
# tsx is invoked directly rather than through npx. npx wants a cache directory, and
# because compose runs this container as the host's uid (which has no home inside the
# image) it tried to create /.npm and died in a restart loop. Nothing needs npm at
# runtime.
CMD ["./node_modules/.bin/tsx", "server/src/index.ts"]
