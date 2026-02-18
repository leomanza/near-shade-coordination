FROM node:22-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .

# Next.js bakes NEXT_PUBLIC_* at build time — pass them as build args
ARG NEXT_PUBLIC_COORDINATOR_URL
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_NEAR_NETWORK
ARG NEXT_PUBLIC_contractId
ARG NEXT_PUBLIC_REGISTRY_CONTRACT_ID
ENV NEXT_PUBLIC_COORDINATOR_URL=$NEXT_PUBLIC_COORDINATOR_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_NEAR_NETWORK=$NEXT_PUBLIC_NEAR_NETWORK
ENV NEXT_PUBLIC_contractId=$NEXT_PUBLIC_contractId
ENV NEXT_PUBLIC_REGISTRY_CONTRACT_ID=$NEXT_PUBLIC_REGISTRY_CONTRACT_ID

RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["npm", "run", "start"]
