FROM node:22-slim
WORKDIR /app
COPY server/package.json ./
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --omit=dev
COPY server/ ./
ENV PORT=3000
EXPOSE 3000
CMD ["node", "src/index.js"]
