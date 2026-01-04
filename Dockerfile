# ============================================
# Keson Spectral Improver Core - Dockerfile
# ============================================
# Node.js + Python environment for audio download and quality analysis

FROM node:20-slim AS base

# Install Python 3.11, ffmpeg, sox and other dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 \
    python3.11-venv \
    python3-pip \
    ffmpeg \
    sox \
    wget \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.11 /usr/bin/python3

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install Node dependencies
RUN npm ci --only=production

# Copy source code
COPY src/ ./src/
COPY bin/ ./bin/
COPY vendor/ ./vendor/

# Install Python dependencies for musicdl and whatsmybitrate
RUN python3 -m pip install --break-system-packages \
    musicdl \
    numpy \
    scipy \
    && chmod +x bin/* 2>/dev/null || true

# Create downloads directory
RUN mkdir -p /app/downloads

# Environment
ENV NODE_ENV=production
ENV PORT=3001
ENV DOWNLOADS_DIR=/app/downloads

EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget -q --spider http://localhost:3001/health || exit 1

CMD ["node", "src/server.js"]
