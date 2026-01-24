# Keson Spectral Improver Core

The brain of the operation. This package handles the heavy lifting: downloading from SoundCloud, performing spectral analysis to detect fake bitrates, and managing the processing queue. It is used by both the [Telegram Bot](../keson-spectral-improver-telegram) and the [Desktop GUI](../keson-spectral-improver-gui).

## 🧠 What it does

- **Smart Downloading**: Fetches tracks from SoundCloud with fallback mechanisms.
- **Spectral Analysis**: Uses `ffmpeg` and local algorithms to determine the _true_ quality of an audio file, flagging upscales.
- **Queue Management**: robust task queue for handling large playlists without rate-limiting issues.

## 🛠 Usage

### As a Library

```javascript
const core = require("keson-spectral-improver-core");

// Download a track
const result = await core.downloadTrack("https://soundcloud.com/artist/track");

// Analyze quality
const quality = await core.analyzeTrackQuality(result.path, result.metadata);
console.log(`True Bitrate: ${quality.estimated_bitrate}`);
```

### Configuration (Environment Variables)

The core requires specific environment variables to function correctly.

| Variable                  | Required | Description                                              |
| :------------------------ | :------: | :------------------------------------------------------- |
| `SOUNDCLOUD_OAUTH_TOKEN`  |    ✅    | OAuth token for SoundCloud API access.                   |
| `YT_DLP_BINARY_PATH`      |    ❌    | Custom path to `yt-dlp` binary.                          |
| `FFMPEG_PATH`             |    ❌    | Custom path to `ffmpeg`.                                 |
| `FFPROBE_PATH`            |    ❌    | Custom path to `ffprobe`.                                |
| `ENABLE_QUALITY_ANALYSIS` |    ❌    | Set to `true` to enable spectral checks (default: true). |

## 🐳 Docker Deployment

You can run the core services (if using the server/bot mode) via Docker.

```bash
# Build the container
docker-compose build

# Run in background
docker-compose up -d
```

## 📦 API Reference

- `downloadTrack(url)`: Main entry point for fetching audio.
- `analyzeTrackQuality(filePath, metadata)`: Returns quality score and spectral stats.
- `createTaskQueue(concurrency)`: Returns a queue instance for managing jobs.
- `utils`: Helper bundle for URL parsing and string formatting.
