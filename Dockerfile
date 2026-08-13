FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip fonts-liberation ca-certificates && \
    pip3 install --break-system-packages --no-cache-dir yt-dlp && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production CFC_FFMPEG=/usr/bin/ffmpeg CFC_FFPROBE=/usr/bin/ffprobe
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY saas/package*.json ./saas/
RUN cd saas && npm ci --omit=dev
COPY saas/worker ./saas/worker
WORKDIR /app/saas
CMD ["node", "worker/clip-worker.mjs"]
