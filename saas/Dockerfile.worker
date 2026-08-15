FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip fonts-liberation ca-certificates git && \
    pip3 install --break-system-packages --no-cache-dir yt-dlp yt-dlp-ejs bgutil-ytdlp-pot-provider==1.3.1 && \
    git clone --depth 1 --branch 1.3.1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil-ytdlp-pot-provider && \
    cd /opt/bgutil-ytdlp-pot-provider/server && npm ci && npx tsc && rm -rf /opt/bgutil-ytdlp-pot-provider/.git && \
    python3 -m yt_dlp --version && ffmpeg -version >/dev/null && \
    rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production CFC_PYTHON=/usr/bin/python3 CFC_YTDLP_POT_SERVER_HOME=/opt/bgutil-ytdlp-pot-provider/server CFC_YTDLP_COOKIES=none CFC_FFMPEG=/usr/bin/ffmpeg CFC_FFPROBE=/usr/bin/ffprobe
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY saas/package*.json ./saas/
RUN cd saas && npm ci --omit=dev
COPY saas/worker ./saas/worker
WORKDIR /app/saas
CMD ["node", "worker/clip-worker.mjs"]
