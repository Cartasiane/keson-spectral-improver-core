# Keson Spectral Improver Core

Headless logic (SoundCloud download, quality analysis, IDHS resolution, queue helper, captions/messages) shared by the Telegram bot and GUI.

## Exports
- `downloadTrack(url)` -> { tempDir, path, filename, metadata, rateLimited? }
- `cleanupTempDir(dir)`
- `fetchPlaylistTracks(url, limit?)`
- `analyzeTrackQuality(filePath, metadata)`
- `qualityDebug(...args)`
- `buildCaption(metadata, qualityInfo)` / `appendQuality`
- `createTaskQueue(concurrency, maxQueue)`
- `isIdhsSupportedLink(url)` / `resolveLinkViaIdhs(url)`
- `utils` (url extraction, formatting helpers)
- `messages` (user-facing strings)
- `config` (`validateCoreEnv`, yt-dlp + SC + ffprobe paths)

## Env
- `SOUNDCLOUD_OAUTH_TOKEN` (required)
- Optional: `YT_DLP_BINARY_PATH`, `YT_DLP_DOWNLOAD_BASE`, `YT_DLP_SKIP_CERT_CHECK`, `FFMPEG_PATH`, `FFPROBE_PATH`, `IDHS_API_BASE_URL`, `IDHS_REQUEST_TIMEOUT_MS`, `ENABLE_QUALITY_ANALYSIS`, `QUALITY_ANALYSIS_DEBUG`.

## Usage
```js
const core = require('keson-spectral-improver-core')
const { downloadTrack, analyzeTrackQuality, createTaskQueue } = core
```
