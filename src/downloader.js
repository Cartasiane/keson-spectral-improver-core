'use strict'

const { spawn } = require('node:child_process')
const fsp = require('node:fs/promises')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const config = require('./config')

/**
 * Download a track from a URL.
 * - SoundCloud URLs: use yt-dlp
 * - Tidal URLs: use tidal-dl-ng
 * - Other URLs: try yt-dlp first, then tidal-dl-ng
 */
async function downloadTrack(url, options = {}) {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'keson-dl-'))

  try {
    let result

    if (isSoundCloudUrl(url)) {
      result = await downloadWithYtDlp(url, tmpDir, options)
    } else if (isTidalUrl(url)) {
      result = await downloadWithTidalDlNg(url, tmpDir, options)
    } else {
      // Try yt-dlp first (supports many sites), fallback to tidal-dl-ng
      try {
        result = await downloadWithYtDlp(url, tmpDir, options)
      } catch (ytdlpError) {
        console.warn('[downloader] yt-dlp failed, trying tidal-dl-ng:', ytdlpError.message)
        result = await downloadWithTidalDlNg(url, tmpDir, options)
      }
    }

    return {
      tempDir: tmpDir,
      path: result.filePath,
      filename: path.basename(result.filePath),
      metadata: result.metadata
    }
  } catch (error) {
    await cleanupTempDir(tmpDir)
    throw error
  }
}

/**
 * Download using yt-dlp (primarily for SoundCloud)
 */
async function downloadWithYtDlp(url, outputDir, options = {}) {
  const ytdlpPath = config.YT_DLP_BINARY_PATH || 'yt-dlp'
  const cookiesPath = options.cookiesPath || config.YT_DLP_COOKIES_PATH

  const args = [
    '--no-playlist',
    '-x',  // Extract audio
    '--audio-format', 'best',
    '--audio-quality', '0',  // Best quality
    '-o', path.join(outputDir, '%(title)s.%(ext)s'),
    '--write-info-json',
    '--no-warnings',
  ]

  // Add cookies if available (for premium SoundCloud)
  if (cookiesPath && fs.existsSync(cookiesPath)) {
    args.push('--cookies', cookiesPath)
  }

  // Add OAuth token if available (alternative to cookies for SoundCloud)
  if (config.SOUNDCLOUD_OAUTH_TOKEN) {
    args.push('--add-header', `Authorization:OAuth ${config.SOUNDCLOUD_OAUTH_TOKEN}`)
  }

  // Skip certificate check if configured
  if (config.YT_DLP_SKIP_CERT_CHECK) {
    args.push('--no-check-certificates')
  }

  args.push(url)

  console.log(`[yt-dlp] Downloading: ${url}`)

  const { stdout, stderr } = await spawnCollect(ytdlpPath, args, { cwd: outputDir })

  // Find the downloaded file
  const files = await fsp.readdir(outputDir)
  const audioFile = files.find(f => !f.endsWith('.json') && !f.startsWith('.'))
  const infoFile = files.find(f => f.endsWith('.info.json'))

  if (!audioFile) {
    throw new Error(`yt-dlp did not produce an audio file. stderr: ${stderr}`)
  }

  // Parse metadata from info.json if available
  let metadata = {}
  if (infoFile) {
    try {
      const infoJson = await fsp.readFile(path.join(outputDir, infoFile), 'utf8')
      const info = JSON.parse(infoJson)
      metadata = {
        title: info.title || info.track,
        artist: info.uploader || info.artist || info.channel,
        album: info.album,
        duration: info.duration,
        bitrate: info.abr || info.tbr,
        source: 'soundcloud'
      }
    } catch (e) {
      console.warn('[yt-dlp] Failed to parse info.json:', e.message)
    }
  }

  return {
    filePath: path.join(outputDir, audioFile),
    metadata
  }
}

/**
 * Download using tidal-dl-ng (for Tidal URLs)
 */
async function downloadWithTidalDlNg(url, outputDir, options = {}) {
  const tidalPath = config.TIDAL_DL_NG_PATH || 'tidal-dl-ng'

  const args = [
    'dl',
    '--output-dir', outputDir,
    url
  ]

  console.log(`[tidal-dl-ng] Downloading: ${url}`)

  const { stdout, stderr } = await spawnCollect(tidalPath, args, { cwd: outputDir })

  // Find the downloaded file (tidal-dl-ng creates subdirectories)
  const filePath = await findNewestAudioFile(outputDir)

  if (!filePath) {
    throw new Error(`tidal-dl-ng did not produce an audio file. stderr: ${stderr}`)
  }

  // Extract basic metadata from filename/path
  const filename = path.basename(filePath, path.extname(filePath))
  const metadata = {
    title: filename,
    source: 'tidal'
  }

  return {
    filePath,
    metadata
  }
}

/**
 * Recursively find the newest audio file in a directory
 */
async function findNewestAudioFile(dir) {
  const audioExtensions = ['.flac', '.mp3', '.m4a', '.aac', '.ogg', '.opus', '.wav']
  let newestFile = null
  let newestMtime = 0

  async function walk(currentDir) {
    const entries = await fsp.readdir(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        if (audioExtensions.includes(ext)) {
          const stat = await fsp.stat(fullPath)
          if (stat.mtimeMs > newestMtime) {
            newestMtime = stat.mtimeMs
            newestFile = fullPath
          }
        }
      }
    }
  }

  await walk(dir)
  return newestFile
}

/**
 * Check if URL is a SoundCloud URL
 */
function isSoundCloudUrl(url) {
  try {
    const { hostname } = new URL(url)
    return /soundcloud\.com/i.test(hostname)
  } catch {
    return false
  }
}

/**
 * Check if URL is a Tidal URL
 */
function isTidalUrl(url) {
  try {
    const { hostname } = new URL(url)
    return /tidal\.com/i.test(hostname)
  } catch {
    return false
  }
}

/**
 * Spawn a process and collect stdout/stderr
 */
function spawnCollect(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })
    child.on('error', err => {
      reject(new Error(`Failed to spawn ${cmd}: ${err.message}`))
    })
    child.on('close', code => {
      if (code !== 0) {
        const error = new Error(`${cmd} exited with code ${code}`)
        error.stdout = stdout
        error.stderr = stderr
        return reject(error)
      }
      resolve({ stdout, stderr })
    })
  })
}

/**
 * Clean up a temporary directory
 */
async function cleanupTempDir(dir) {
  try {
    await fsp.rm(dir, { recursive: true, force: true })
  } catch (e) {
    console.warn('[downloader] Failed to cleanup temp dir:', e.message)
  }
}

/**
 * Fetch tracks from a SoundCloud playlist (via yt-dlp)
 */
async function fetchPlaylistTracks(url, limit = 50) {
  const ytdlpPath = config.YT_DLP_BINARY_PATH || 'yt-dlp'

  const args = [
    '--flat-playlist',
    '-J',  // JSON output
    '--playlist-end', String(limit),
    url
  ]

  const { stdout } = await spawnCollect(ytdlpPath, args)
  const data = JSON.parse(stdout)

  if (!data.entries || !Array.isArray(data.entries)) {
    return []
  }

  return data.entries.map(entry => ({
    url: entry.url || entry.webpage_url,
    title: entry.title,
    duration: entry.duration
  }))
}

module.exports = {
  downloadTrack,
  cleanupTempDir,
  fetchPlaylistTracks,
  isSoundCloudUrl,
  isTidalUrl
}
