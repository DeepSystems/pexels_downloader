FROM node:9.4.0-slim

WORKDIR /app

COPY package.json yarn.lock /app/
RUN yarn && yarn cache clean

COPY index.js /app/dist/
WORKDIR /app/dist

ENTRYPOINT ["node", "."]
