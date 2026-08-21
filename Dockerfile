FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY config ./config
RUN mkdir -p data && chown -R node:node /app
USER node
CMD ["node", "src/index.js"]
