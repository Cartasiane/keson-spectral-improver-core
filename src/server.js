'use strict'

const express = require('express')
const path = require('path')
const fs = require('fs')
const fsp = require('fs/promises')
const os = require('os')

const { downloadTrack, cleanupTempDir } = require('./downloader')
const { analyzeTrackQuality } = require('./quality')
const { isIdhsSupportedLink, resolveLinkViaIdhs } = require('./idhs')
const { searchTrack, searchTracks } = require('./tidal')
const { searchSoundCloud } = require('./soundcloud')
const { extractMetadata, buildSearchQuery } = require('./metadata')
const { scoreMatch } = require('./matcher')
const { createTaskQueue } = require('./queue')
const config = require('./config')
const { registerClient, getAuthStatus, authMiddleware } = require('./auth')

// Rate limiting configuration
const MAX_CONCURRENT_DOWNLOADS = parseInt(process.env.MAX_CONCURRENT_DOWNLOADS) || 3
const MAX_QUEUE_SIZE = parseInt(process.env.MAX_QUEUE_SIZE) || 20
const downloadQueue = createTaskQueue(MAX_CONCURRENT_DOWNLOADS, MAX_QUEUE_SIZE)

const app = express()
const PORT = process.env.PORT || 3001
const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR || path.join(os.tmpdir(), 'keson-downloads')

// Ensure downloads directory exists
fs.mkdirSync(DOWNLOADS_DIR, { recursive: true })

app.use(express.json())

// Serve downloaded files (and delete after sending)
// Protected: requires valid client token
app.use('/files', authMiddleware, (req, res, next) => {
  const filePath = path.join(DOWNLOADS_DIR, req.path)
  const resolved = path.resolve(filePath)
  
  // Path traversal protection
  if (!resolved.startsWith(path.resolve(DOWNLOADS_DIR))) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  
  // Check if file exists
  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: 'File not found' })
  }
  
  // Send file, then delete it after transfer completes
  res.sendFile(resolved, (err) => {
    if (err) {
      console.error(`[files] Error sending file: ${err.message}`)
    } else {
      // Delete file after successful transfer
      fs.unlink(resolved, (unlinkErr) => {
        if (unlinkErr) {
          console.error(`[files] Failed to delete after serving: ${resolved}`, unlinkErr.message)
        } else {
          console.log(`[files] Cleaned up: ${resolved}`)
        }
      })
    }
  })
})

// ---- Health Check ----
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'keson-core',
    version: require('../package.json').version,
    uptime: process.uptime(),
    idhs_configured: !!config.IDHS_API_BASE_URL,
    queue: {
      max_concurrent: MAX_CONCURRENT_DOWNLOADS,
      max_queue_size: MAX_QUEUE_SIZE
    }
  })
})

// ---- Auth Status (public) ----
app.get('/auth/status', (req, res) => {
  const status = getAuthStatus()
  res.json({
    success: true,
    ...status
  })
})

// ---- Client Registration ----
app.post('/register', (req, res) => {
  const { invite_code, device_name } = req.body
  
  if (!invite_code) {
    return res.status(400).json({ error: 'Missing invite_code' })
  }
  
  try {
    const token = registerClient(invite_code, { device_name })
    res.json({
      success: true,
      client_token: token
    })
  } catch (err) {
    if (err.message === 'INVALID_INVITE_CODE') {
      return res.status(401).json({ 
        error: 'Invalid invite code',
        code: 'INVALID_INVITE_CODE'
      })
    }
    console.error('[register] Error:', err)
    res.status(500).json({ error: 'Registration failed' })
  }
})

// ---- Download Track ----
// Protected: requires valid client token
app.post('/download', authMiddleware, async (req, res) => {
  const { url, source, token } = req.body

  if (!url) {
    return res.status(400).json({ error: 'Missing URL' })
  }

  console.log(`[download] Request for: ${url}`)

  try {
    const result = await downloadQueue.add(async () => {
      const dlResult = await downloadTrack(url, { source, token })

      // Move file from temp to downloads directory
      const filename = path.basename(dlResult.path)
      const destPath = path.join(DOWNLOADS_DIR, filename)
      await fsp.copyFile(dlResult.path, destPath)
      await cleanupTempDir(dlResult.tempDir)

      return { ...dlResult, filename, downloadUrl: `/files/${filename}` }
    })

    res.json({
      success: true,
      metadata: result.metadata,
      filename: result.filename,
      downloadUrl: result.downloadUrl
    })
  } catch (error) {
    if (error.code === 'QUEUE_FULL') {
      console.warn('[download] Queue full, rejecting request')
      return res.status(503).json({ error: 'Server busy, try again later', code: 'QUEUE_FULL' })
    }
    console.error('[download] Failed:', error)
    res.status(500).json({ error: error.message })
  }
})

// ---- Analyze Quality ----
// NOTE: This endpoint requires the file to exist on the Core server's filesystem.
// It works for files that Core has downloaded (e.g., via /download endpoint), 
// but NOT for files that only exist on the GUI client's machine.
// For remote GUI deployments, quality analysis is done locally in the GUI using whatsmybitrate.
// Protected: requires valid client token
app.post('/analyze', authMiddleware, async (req, res) => {
  const { filePath, metadata } = req.body

  if (!filePath) {
    return res.status(400).json({ error: 'Missing filePath' })
  }

  console.log(`[analyze] Request for: ${filePath}`)

  try {
    // Check if file exists
    const resolvedPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(DOWNLOADS_DIR, filePath)

    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: 'File not found' })
    }

    const quality = await analyzeTrackQuality(resolvedPath, metadata || {})

    res.json({
      success: true,
      quality
    })
  } catch (error) {
    console.error('[analyze] Failed:', error)
    res.status(500).json({ error: error.message })
  }
})

// ---- Unified Track Search Endpoint ----
// Searches Tidal first, falls back to SoundCloud
// Accepts POST with JSON body: { query, metadata: { artist, title, duration, isrc } }
// The metadata can be extracted by the GUI locally using ffprobe and sent directly,
// avoiding the need for the Core server to access local files.

async function handleTrackSearch(req, res) {
  // Support both GET (query params) and POST (JSON body)
  const query = req.body?.query || req.query?.query
  const providedMetadata = req.body?.metadata
  
  const TIDAL_THRESHOLD = config.TIDAL_MATCH_THRESHOLD
  const SOUNDCLOUD_THRESHOLD = config.SOUNDCLOUD_MATCH_THRESHOLD

  if (!query && !providedMetadata) {
    return res.status(400).json({ error: 'Missing query or metadata' })
  }

  try {
    // Step 1: Use provided metadata or parse from query string
    let metadata
    if (providedMetadata && (providedMetadata.artist || providedMetadata.title)) {
      // Metadata provided directly by GUI (extracted via ffprobe)
      console.log(`[search/track] Using provided metadata: artist="${providedMetadata.artist}", title="${providedMetadata.title}", isrc="${providedMetadata.isrc}", duration=${providedMetadata.duration}`)
      metadata = providedMetadata
    } else if (query) {
      // Parse query string as "Artist - Title" or just use as title
      const parts = query.split(' - ')
      if (parts.length >= 2) {
        metadata = { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() }
      } else {
        metadata = { title: query }
      }
      console.log(`[search/track] Parsed query: artist="${metadata.artist}", title="${metadata.title}"`)
    } else {
      return res.status(400).json({ error: 'No usable metadata or query provided' })
    }

    console.log(`[search/track] Metadata: artist="${metadata.artist}", title="${metadata.title}", duration=${metadata.duration}`)

    // Step 2: Try Tidal first
    const tidalCandidates = await searchTracks(metadata)
    if (tidalCandidates.length > 0) {
      const scored = tidalCandidates.map(c => ({
        ...c,
        score: scoreMatch(metadata, c),
        source: 'tidal'
      }))
      scored.sort((a, b) => b.score - a.score)

      if (scored[0].score >= TIDAL_THRESHOLD) {
        console.log(`[search/track] Tidal match: "${scored[0].title}" (score: ${scored[0].score})`)
        return res.json({
          success: true,
          found: true,
          source: 'tidal',
          url: scored[0].url,
          score: scored[0].score,
          title: scored[0].title,
          artist: scored[0].artist,
          cover_url: scored[0].cover_url
        })
      }
      console.log(`[search/track] Tidal match: "${scored[0].title}" — Cover: ${scored[0].cover_url}`)
      console.log(`[search/track] Tidal best: ${scored[0].score} < ${TIDAL_THRESHOLD}, trying SoundCloud...`)
    } else {
      console.log(`[search/track] No Tidal results, trying SoundCloud...`)
    }

    // Step 3: Fallback to SoundCloud
    const scCandidates = await searchSoundCloud(metadata)
    if (scCandidates.length > 0) {
      const scored = scCandidates.map(c => ({
        ...c,
        score: scoreMatch(metadata, c),
        source: 'soundcloud'
      }))
      scored.sort((a, b) => b.score - a.score)

      if (scored[0].score >= SOUNDCLOUD_THRESHOLD) {
        console.log(`[search/track] SoundCloud match: "${scored[0].title}" (score: ${scored[0].score})`)
        return res.json({
          success: true,
          found: true,
          source: 'soundcloud',
          url: scored[0].url,
          title: scored[0].title,
          artist: scored[0].artist,
          cover_url: scored[0].cover_url
        })
      }
    }

    // Step 4: Both sources failed
    console.log(`[search/track] No confident match found on Tidal or SoundCloud`)
    return res.json({
      success: true,
      found: false,
      message: 'No confident match found'
    })

  } catch (error) {
    console.error('[search/track] Failed:', error)
    res.status(500).json({ error: error.message })
  }
}

// POST endpoint (preferred - accepts metadata JSON body)
// Protected: requires valid client token
app.post('/search/track', authMiddleware, handleTrackSearch)

// GET endpoint (backward compatibility - query params only)
// Protected: requires valid client token
app.get('/search/track', authMiddleware, handleTrackSearch)

// ---- Legacy Tidal Search Endpoint (backwards compatibility) ----
// Protected: requires valid client token
app.get('/search/tidal', authMiddleware, async (req, res) => {
  const { query } = req.query

  if (!query) {
    return res.status(400).json({ error: 'Missing query parameter' })
  }

  console.log(`[search/tidal] Request for: ${query}`)

  try {
    const trackUrl = await searchTrack(query)
    
    if (trackUrl) {
      console.log(`[search/tidal] Found: ${trackUrl}`)
      res.json({
        success: true,
        found: true,
        source: 'tidal',
        url: trackUrl
      })
    } else {
      console.log(`[search/tidal] Not found.`)
      res.json({
        success: true,
        found: false
      })
    }
  } catch (error) {
    console.error('[search/tidal] Failed:', error)
    res.status(500).json({ error: error.message })
  }
})

// ---- Resolve Link via IDHS ----
// Protected: requires valid client token
app.post('/resolve', authMiddleware, async (req, res) => {
  const { url } = req.body

  if (!url) {
    return res.status(400).json({ error: 'Missing URL' })
  }

  console.log(`[resolve] Request for: ${url}`)

  try {
    if (!isIdhsSupportedLink(url)) {
      return res.status(400).json({
        error: 'Unsupported link type',
        supported: ['spotify.com', 'music.apple.com', 'deezer.com', 'tidal.com', 'youtube.com', 'youtu.be']
      })
    }

    const soundcloudUrl = await resolveLinkViaIdhs(url)

    if (!soundcloudUrl) {
      return res.status(404).json({ error: 'Could not find SoundCloud equivalent' })
    }

    res.json({
      success: true,
      original: url,
      soundcloud: soundcloudUrl
    })
  } catch (error) {
    console.error('[resolve] Failed:', error)
    res.status(500).json({ error: error.message })
  }
})

// ---- Download + Resolve (convenience endpoint) ----
// Protected: requires valid client token
app.post('/download-any', authMiddleware, async (req, res) => {
  const { url, source, token } = req.body

  if (!url) {
    return res.status(400).json({ error: 'Missing URL' })
  }

  console.log(`[download-any] Request for: ${url}`)

  try {
    let targetUrl = url

    // If it's a non-SoundCloud link, try to resolve via IDHS first
    // EXCEPTION: Tidal links should be handled directly by native downloader, bypassing IDHS
    const isTidal = /tidal\.com/i.test(url)

    if (isIdhsSupportedLink(url) && !isTidal) {
      console.log('[download-any] Resolving via IDHS...')
      const soundcloudUrl = await resolveLinkViaIdhs(url)
      if (soundcloudUrl) {
        console.log(`[download-any] Resolved to: ${soundcloudUrl}`)
        targetUrl = soundcloudUrl
      } else {
        return res.status(404).json({ error: 'Could not find SoundCloud equivalent' })
      }
    }

    // Queue the download
    const result = await downloadQueue.add(async () => {
      const dlResult = await downloadTrack(targetUrl, { source, token })

      // Move file from temp to downloads directory
      const filename = path.basename(dlResult.path)
      const destPath = path.join(DOWNLOADS_DIR, filename)
      await fsp.copyFile(dlResult.path, destPath)
      await cleanupTempDir(dlResult.tempDir)

      // Also run quality analysis
      let quality = null
      try {
        quality = await analyzeTrackQuality(destPath, dlResult.metadata || {})
      } catch (err) {
        console.warn('[download-any] Quality analysis failed:', err.message)
      }

      return {
        ...dlResult,
        filename,
        destPath,
        quality,
        downloadUrl: `/files/${filename}`
      }
    })

    res.json({
      success: true,
      originalUrl: url,
      resolvedUrl: targetUrl !== url ? targetUrl : null,
      metadata: result.metadata,
      quality: result.quality,
      filename: result.filename,
      downloadUrl: result.downloadUrl
    })
  } catch (error) {
    if (error.code === 'QUEUE_FULL') {
      console.warn('[download-any] Queue full, rejecting request')
      return res.status(503).json({ error: 'Server busy, try again later', code: 'QUEUE_FULL' })
    }
    console.error('[download-any] Failed:', error)
    res.status(500).json({ error: error.message })
  }
})

// ---- Start server ----
const server = app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Keson Core Server running on port ${PORT}`)
  console.log(`IDHS API: ${config.IDHS_API_BASE_URL}`)
  console.log(`Quality analysis: ${config.ENABLE_QUALITY_ANALYSIS ? 'enabled' : 'disabled'}`)
  
  // Check Tidal auth status
  await checkTidalAuth()
})

/**
 * Check if tidal-dl-ng is authenticated
 */
async function checkTidalAuth() {
  const { spawnCollect } = require('./utils')
  const tidalPath = config.TIDAL_DL_NG_PATH || 'tidal-dl-ng'
  
  try {
    // Run tidal-dl-ng with a dummy command to check login status
    const result = await spawnCollect(tidalPath, ['cfg', 'show'], { timeout: 10000 })
    
    if (result.stdout.includes('logged in') || result.stdout.includes('token')) {
      console.log('═══════════════════════════════════════════════════════════')
      console.log('  ✅ TIDAL: Authenticated')
      console.log('═══════════════════════════════════════════════════════════')
    } else {
      console.log('═══════════════════════════════════════════════════════════')
      console.log('  ⚠️  TIDAL: Not authenticated - run "tidal-dl-ng login" in container')
      console.log('═══════════════════════════════════════════════════════════')
    }
  } catch (err) {
    console.log('═══════════════════════════════════════════════════════════')
    console.log('  ❌ TIDAL: Auth check failed -', err.message)
    console.log('  💡 Run: docker exec -it <container> tidal-dl-ng login')
    console.log('═══════════════════════════════════════════════════════════')
  }
}

// Graceful shutdown for Docker
process.on('SIGTERM', () => {
  console.log('[server] SIGTERM received, shutting down gracefully...')
  server.close(() => {
    console.log('[server] HTTP server closed')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  console.log('[server] SIGINT received, shutting down...')
  server.close(() => {
    process.exit(0)
  })
})
