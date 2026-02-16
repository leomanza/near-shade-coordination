FROM node:20-slim AS builder

WORKDIR /app

# Copy shared package first
COPY shared/package.json shared/tsconfig.json ./shared/
COPY shared/src ./shared/src
RUN cd shared && npm install && npm run build

# Copy worker-agent
COPY worker-agent/package.json worker-agent/tsconfig.json ./worker-agent/
RUN cd worker-agent && npm install
COPY worker-agent/src ./worker-agent/src
RUN cd worker-agent && npm run build

FROM node:20-slim

WORKDIR /app

COPY --from=builder /app/shared ./shared
COPY --from=builder /app/worker-agent ./worker-agent

WORKDIR /app/worker-agent

ENV PORT=3001
EXPOSE 3001

CMD ["node", "dist/index.js"]
