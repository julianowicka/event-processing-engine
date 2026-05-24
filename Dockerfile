FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json yarn.lock ./
RUN corepack enable \
  && corepack prepare yarn@1.22.22 --activate \
  && yarn install --frozen-lockfile

COPY . .
RUN yarn build

ENV NODE_ENV=production
ENV PORT=3000
ENV SQLITE_DB_PATH=/data/app.sqlite

EXPOSE 3000

CMD ["node", "dist/main.js"]
