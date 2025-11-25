'use strict'

const { create: createYtDlp } = require('yt-dlp-exec')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const https = require('node:https')
const { pipeline } = require('node:stream/promises')
const {
  INFO_SUFFIX,
  SOUNDCLOUD_OAUTH_TOKEN,
  THUMB_EXTENSIONS,
  YT_DLP_BINARY_PATH,
  BINARY_CACHE_DIR,
  YT_DLP_RELEASE_BASE,
  YT_DLP_SKIP_CERT_CHECK
} = require('./config')
const messages = require('./messages')

let ytdlpInstancePromise

async function downloadTrack(url) {
  const ytdlp = await getYtDlp()

  const primaryOpts = buildYtDlpOptions({ useOAuth: true })
  try {
    return await attemptDownload(ytdlp, url, primaryOpts)
  } catch (error) {
    if (!isSoundCloudRateLimitError(error)) throw error

    console.warn('SoundCloud premium rate limit hit; retrying without OAuth cookie...')
    const fallbackOpts = buildYtDlpOptions({
      useOAuth: false,
      format:
        'bestaudio[abr<=192][acodec^=mp4a]/bestaudio[abr<=192][ext!=opus][acodec!=opus]/bestaudio'
    })
    const result = await attemptDownload(ytdlp, url, fallbackOpts)
    result.rateLimited = true
    return result
  }
}

function buildYtDlpOptions({ useOAuth, format } = {}) {
  const headers = useOAuth && SOUNDCLOUD_OAUTH_TOKEN
    ? [`Authorization: OAuth ${SOUNDCLOUD_OAUTH_TOKEN}`]
    : undefined
  const options = {
    output: null, // filled per attempt
    format: format || 'bestaudio[ext!=opus][acodec!=opus]/http_aac_1_0/bestaudio/best',
    addHeader: headers,
    noPlaylist: true,
    retries: 3,
    noPart: true,
    quiet: true,
    addMetadata: true,
    embedThumbnail: true,
    convertThumbnails: 'jpg',
    writeInfoJson: true
  }

  if (YT_DLP_SKIP_CERT_CHECK) {
    options.noCheckCertificates = true
  }

  return options
}

async function attemptDownload(ytdlp, url, options) {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'sc-dl-'))
  const opts = { ...options, output: path.join(tmpDir, '%(title)s.%(ext)s') }

  try {
    await ytdlp(url, opts)

    const files = await fsp.readdir(tmpDir)
    if (!files.length) {
      const err = new Error('SoundCloud returned no downloadable audio for this link.')
      err.userMessage = messages.missingAudioFile()
      throw err
    }

    const { audioFile, metadata } = await pickAudioFile(tmpDir, files)
    return { tempDir: tmpDir, path: audioFile.path, filename: audioFile.name, metadata }
  } catch (error) {
    await cleanupTempDir(tmpDir)
    throw error
  }
}

function isSoundCloudRateLimitError(error) {
  const text = [error?.message, error?.stderr, error?.stdout]
    .filter(Boolean)
    .join('\n')
    .toLowerCase()
  if (!text) return false
  return (
    text.includes('429') ||
    text.includes('too many requests') ||
    text.includes('rate limit') ||
    text.includes('temporarily blocked')
  )
}

async function cleanupTempDir(dir) {
  await fsp.rm(dir, { recursive: true, force: true })
}

async function getYtDlp() {
  if (!ytdlpInstancePromise) {
    ytdlpInstancePromise = ensureYtDlpBinary().then(binaryPath => {
      console.log(`Using yt-dlp binary at ${binaryPath}`)
      return createYtDlp(binaryPath)
    })
  }
  return ytdlpInstancePromise
}

async function ensureYtDlpBinary() {
  if (YT_DLP_BINARY_PATH) {
    return YT_DLP_BINARY_PATH
  }

  const { filename, url, note } = pickBinaryArtifact()
  const targetPath = path.join(BINARY_CACHE_DIR, filename)

  try {
    await fsp.access(targetPath, fs.constants.X_OK)
    return targetPath
  } catch {
    // fall through to download
  }

  console.log(`Downloading yt-dlp (${note}) ...`)
  await fsp.mkdir(BINARY_CACHE_DIR, { recursive: true })
  await downloadWithRedirects(url, targetPath)
  if (process.platform !== 'win32') {
    await fsp.chmod(targetPath, 0o755)
  }
  return targetPath
}

function pickBinaryArtifact() {
  if (process.platform === 'darwin') {
    return {
      filename: 'yt-dlp_macos',
      url: `${YT_DLP_RELEASE_BASE}yt-dlp_macos`,
      note: 'macOS universal binary'
    }
  }

  if (process.platform === 'win32') {
    return {
      filename: 'yt-dlp.exe',
      url: `${YT_DLP_RELEASE_BASE}yt-dlp.exe`,
      note: 'Windows standalone binary'
    }
  }

  if (process.platform === 'linux') {
    if (process.arch === 'arm64' || process.arch === 'aarch64') {
      return {
        filename: 'yt-dlp_linux_arm64',
        url: `${YT_DLP_RELEASE_BASE}yt-dlp_linux_arm64`,
        note: 'Linux ARM64 binary'
      }
    }

    if (process.arch.startsWith('arm')) {
      return {
        filename: 'yt-dlp_linux_armv7l',
        url: `${YT_DLP_RELEASE_BASE}yt-dlp_linux_armv7l`,
        note: 'Linux ARMv7 binary'
      }
    }

    return {
      filename: 'yt-dlp_linux',
      url: `${YT_DLP_RELEASE_BASE}yt-dlp_linux`,
      note: 'Linux x64 binary'
    }
  }

  return {
    filename: 'yt-dlp',
    url: `${YT_DLP_RELEASE_BASE}yt-dlp`,
    note: 'generic script (requires Python 3.10+)'
  }
}

async function downloadWithRedirects(url, filePath, attempt = 0) {
  const MAX_REDIRECTS = 5
  await new Promise((resolve, reject) => {
    const request = https.get(url, response => {
      const { statusCode, headers } = response

      if (
        statusCode &&
        statusCode >= 300 &&
        statusCode < 400 &&
        headers.location
      ) {
        response.resume()
        if (attempt >= MAX_REDIRECTS) {
          reject(new Error('Too many redirects while downloading yt-dlp binary.'))
          return
        }
        downloadWithRedirects(headers.location, filePath, attempt + 1)
          .then(resolve)
          .catch(reject)
        return
      }

      if (statusCode !== 200) {
        response.resume()
        reject(new Error(`Failed to download yt-dlp (status ${statusCode}).`))
        return
      }

      const writeStream = fs.createWriteStream(filePath)
      pipeline(response, writeStream).then(resolve).catch(reject)
    })

    request.on('error', reject)
  })
}

async function pickAudioFile(tmpDir, files) {
  let info
  let infoPath
  const audioCandidates = []

  for (const file of files) {
    if (file.endsWith(INFO_SUFFIX)) {
      infoPath = path.join(tmpDir, file)
      continue
    }

    const ext = path.extname(file).toLowerCase()
    if (THUMB_EXTENSIONS.has(ext) || ext === '.opus') {
      continue
    }

    audioCandidates.push({ name: file, path: path.join(tmpDir, file) })
  }

  if (!audioCandidates.length) {
    const err = new Error('Download finished but no audio file was located.')
    err.userMessage = messages.opusOnlyMessage()
    throw err
  }

  if (infoPath) {
    try {
      info = JSON.parse(await fsp.readFile(infoPath, 'utf8'))
    } catch (error) {
      console.warn('Failed to parse SoundCloud metadata JSON:', error)
    }
  }

  return { audioFile: audioCandidates[0], metadata: info }
}

async function fetchPlaylistTracks(url, limit = 100) {
  const ytdlp = await getYtDlp()
  try {
    const output = await ytdlp(url, {
      dumpSingleJson: true,
      flatPlaylist: true,
      skipDownload: true,
      simulate: true,
      playlistEnd: limit,
      quiet: true
    })
    const parsed = typeof output === 'string' ? JSON.parse(output) : output
    if (parsed?.entries && Array.isArray(parsed.entries)) {
      return parsed.entries
        .map(entry => entry?.url)
        .filter(u => typeof u === 'string')
    }
  } catch (error) {
    console.warn('Unable to fetch playlist entries:', error)
  }
  return []
}

module.exports = {
  cleanupTempDir,
  downloadTrack
  ,
  fetchPlaylistTracks
}
