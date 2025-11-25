'use strict'

const path = require('node:path')
require('dotenv').config()

const SOUNDCLOUD_OAUTH_TOKEN =
  process.env.SOUNDCLOUD_OAUTH_TOKEN || process.env.SOUNDCLOUD_OAUTH
const YT_DLP_BINARY_PATH = process.env.YT_DLP_BINARY_PATH
const BINARY_CACHE_DIR = process.env.BINARY_CACHE_DIR || path.join(__dirname, '..', 'bin')
const YT_DLP_RELEASE_BASE =
  process.env.YT_DLP_DOWNLOAD_BASE ||
  'https://github.com/yt-dlp/yt-dlp/releases/latest/download/'
const YT_DLP_SKIP_CERT_CHECK = process.env.YT_DLP_SKIP_CERT_CHECK === 'true'
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
const ENABLE_QUALITY_ANALYSIS = process.env.ENABLE_QUALITY_ANALYSIS !== 'false'
const QUALITY_ANALYSIS_DEBUG = process.env.QUALITY_ANALYSIS_DEBUG === 'true'
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg'
const FFPROBE_PATH = process.env.FFPROBE_PATH || 'ffprobe'
const SOUND_CLOUD_REGEX = /(https?:\/\/(?:[\w-]+\.)?soundcloud\.com\/[\w\-.\/?=&%+#]+)/i
const THUMB_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const INFO_SUFFIX = '.info.json'

function validateCoreEnv() {
  if (!SOUNDCLOUD_OAUTH_TOKEN) {
    console.error('SOUNDCLOUD_OAUTH_TOKEN is missing. Set it in your environment/.env file.')
    process.exit(1)
  }
}

module.exports = {
  BINARY_CACHE_DIR,
  ENABLE_QUALITY_ANALYSIS,
  FFPROBE_PATH,
  FFMPEG_PATH,
  IDHS_API_BASE_URL,
  IDHS_REQUEST_TIMEOUT_MS,
  IDHS_SUPPORTED_HOSTS,
  INFO_SUFFIX,
  QUALITY_ANALYSIS_DEBUG,
  SOUND_CLOUD_REGEX,
  SOUNDCLOUD_OAUTH_TOKEN,
  THUMB_EXTENSIONS,
  YT_DLP_BINARY_PATH,
  YT_DLP_RELEASE_BASE,
  YT_DLP_SKIP_CERT_CHECK,
  validateCoreEnv
}
