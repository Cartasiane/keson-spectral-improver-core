'use strict'

const path = require('node:path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

// ---- Download Tools ----
const YT_DLP_BINARY_PATH = process.env.YT_DLP_BINARY_PATH || 'yt-dlp'
const YT_DLP_COOKIES_PATH = process.env.YT_DLP_COOKIES_PATH
const YT_DLP_SKIP_CERT_CHECK = process.env.YT_DLP_SKIP_CERT_CHECK === 'true'
const TIDAL_DL_NG_PATH = process.env.TIDAL_DL_NG_PATH || 'tidal-dl-ng'
const TIDAL_CLIENT_ID = process.env.TIDAL_CLIENT_ID
if (TIDAL_CLIENT_ID) {
    console.log(`[config] Loaded TIDAL_CLIENT_ID: ${TIDAL_CLIENT_ID.substring(0, 4)}...`)
} else {
    console.log('[config] TIDAL_CLIENT_ID is NOT set')
}
const TIDAL_CLIENT_SECRET = process.env.TIDAL_CLIENT_SECRET

// ---- IDHS (Link Resolution) ----
const IDHS_API_BASE_URL = process.env.IDHS_API_BASE_URL || 'http://localhost:3000'
const IDHS_REQUEST_TIMEOUT_MS = Number(process.env.IDHS_REQUEST_TIMEOUT_MS || 15000)
const IDHS_SUPPORTED_HOSTS = [
  /spotify\.com/i,
  /music\.apple\.com/i,
  /deezer\.com/i,
  /tidal\.com/i,
  /youtube\.com/i,
  /youtu\.be/i
]

// ---- Quality Analysis ----
const ENABLE_QUALITY_ANALYSIS = process.env.ENABLE_QUALITY_ANALYSIS !== 'false'
const QUALITY_ANALYSIS_DEBUG = process.env.QUALITY_ANALYSIS_DEBUG === 'true'
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg'
const FFPROBE_PATH = process.env.FFPROBE_PATH || 'ffprobe'

// ---- Misc ----
const BINARY_CACHE_DIR = process.env.BINARY_CACHE_DIR || path.join(__dirname, '..', 'bin')
const SOUND_CLOUD_REGEX = /(https?:\/\/(?:[\w-]+\.)?soundcloud\.com\/[\w\-.\/?=&%+#]+)/i
const THUMB_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const INFO_SUFFIX = '.info.json'

// Legacy (kept for backwards compat)
const SOUNDCLOUD_OAUTH_TOKEN = process.env.SOUNDCLOUD_OAUTH_TOKEN || process.env.SOUNDCLOUD_OAUTH

function validateCoreEnv() {
  // yt-dlp and tidal-dl-ng should be available in PATH or configured
  // No hard requirements - will fail at runtime if not available
  console.log('[config] YT_DLP_PATH:', YT_DLP_BINARY_PATH)
  console.log('[config] TIDAL_DL_NG_PATH:', TIDAL_DL_NG_PATH)
  console.log('[config] IDHS_API_BASE_URL:', IDHS_API_BASE_URL)
}

module.exports = {
  // Download tools
  YT_DLP_BINARY_PATH,
  YT_DLP_COOKIES_PATH,
  YT_DLP_SKIP_CERT_CHECK,
  TIDAL_DL_NG_PATH,
  TIDAL_CLIENT_ID,
  TIDAL_CLIENT_SECRET,
  // IDHS
  IDHS_API_BASE_URL,
  IDHS_REQUEST_TIMEOUT_MS,
  IDHS_SUPPORTED_HOSTS,
  // Quality
  ENABLE_QUALITY_ANALYSIS,
  QUALITY_ANALYSIS_DEBUG,
  FFPROBE_PATH,
  FFMPEG_PATH,
  // Misc
  BINARY_CACHE_DIR,
  INFO_SUFFIX,
  SOUND_CLOUD_REGEX,
  SOUNDCLOUD_OAUTH_TOKEN,
  THUMB_EXTENSIONS,
  validateCoreEnv
}
