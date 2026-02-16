FROM node:22-alpine AS builder

WORKDIR /app

# Copy shared package first
COPY shared/package.json shared/tsconfig.json ./shared/
COPY shared/src ./shared/src
RUN cd shared && npm install && npm run build

# Copy coordinator-agent
COPY coordinator-agent/package.json coordinator-agent/tsconfig.json ./coordinator-agent/
RUN cd coordinator-agent && npm install
COPY coordinator-agent/src ./coordinator-agent/src
RUN cd coordinator-agent && npm run build

FROM node:22-alpine

WORKDIR /app

COPY --from=builder /app/shared ./shared
COPY --from=builder /app/coordinator-agent ./coordinator-agent

WORKDIR /app/coordinator-agent

ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/index.js"]
