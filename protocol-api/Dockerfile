FROM node:22-alpine

WORKDIR /app

# Copy shared package
COPY shared/package.json shared/tsconfig.json ./shared/
COPY shared/src ./shared/src
RUN cd shared && npm install && npm run build

# Copy protocol-api
COPY protocol-api/package.json protocol-api/tsconfig.json ./protocol-api/
RUN cd protocol-api && npm install

COPY protocol-api/src ./protocol-api/src
COPY templates ./templates
RUN cd protocol-api && npm run build

WORKDIR /app/protocol-api
EXPOSE 3005
ENV PORT=3005
CMD ["node", "dist/index.js"]
