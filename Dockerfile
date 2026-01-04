# ============================================
# Keson Spectral Improver Core - Dockerfile
# ============================================
# Node.js + Python environment for audio download and quality analysis

FROM node:20-slim AS base

# Install Python 3.11, ffmpeg, sox, yt-dlp and other dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 \
    python3.11-venv \
    python3-pip \
    pipx \
    ffmpeg \
    sox \
    wget \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.11 /usr/bin/python3

WORKDIR /app

# Install yt-dlp and tidal-dl-ng
RUN pipx install yt-dlp && \
    pipx install tidal-dl-ng && \
    pipx ensurepath

# Add pipx bin to PATH
ENV PATH="/root/.local/bin:$PATH"

# Copy package files first for better layer caching
COPY package*.json ./

# Install Node dependencies
RUN npm ci --only=production

# Copy source code
COPY src/ ./src/
COPY bin/ ./bin/
COPY vendor/ ./vendor/
COPY docker-entrypoint.sh ./

# Install Python dependencies for whatsmybitrate (quality analysis)
RUN python3 -m pip install --break-system-packages \
    numpy \
    scipy \
    && chmod +x bin/* 2>/dev/null || true \
    && chmod +x docker-entrypoint.sh

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

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
