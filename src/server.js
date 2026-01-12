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
const config = require('./config')

const app = express()
const PORT = process.env.PORT || 3001
const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR || path.join(os.tmpdir(), 'keson-downloads')

// Ensure downloads directory exists
fs.mkdirSync(DOWNLOADS_DIR, { recursive: true })

app.use(express.json())

// Serve downloaded files (and delete after sending)
app.use('/files', (req, res, next) => {
  const filePath = path.join(DOWNLOADS_DIR, req.path)
  
  // Check if file exists
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' })
  }
  
  // Send file, then delete it after transfer completes
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error(`[files] Error sending file: ${err.message}`)
    } else {
      // Delete file after successful transfer
      fs.unlink(filePath, (unlinkErr) => {
        if (unlinkErr) {
          console.error(`[files] Failed to delete after serving: ${filePath}`, unlinkErr.message)
        } else {
          console.log(`[files] Cleaned up: ${filePath}`)
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
    idhs_configured: !!config.IDHS_API_BASE_URL
  })
})

// ---- Download Track ----
app.post('/download', async (req, res) => {
  const { url, source, token } = req.body

  if (!url) {
    return res.status(400).json({ error: 'Missing URL' })
  }

  console.log(`[download] Request for: ${url}`)

  try {
    const result = await downloadTrack(url, { source, token })

    // Move file from temp to downloads directory
    const filename = path.basename(result.path)
    const destPath = path.join(DOWNLOADS_DIR, filename)
    await fsp.copyFile(result.path, destPath)
    await cleanupTempDir(result.tempDir)

    const downloadUrl = `/files/${filename}`

    res.json({
      success: true,
      metadata: result.metadata,
      filename,
      downloadUrl // Return relative path e.g. /files/song.mp3
    })
  } catch (error) {
    console.error('[download] Failed:', error)
    res.status(500).json({ error: error.message })
  }
})

// ---- Analyze Quality ----
// NOTE: This endpoint requires the file to exist on the Core server's filesystem.
// It works for files that Core has downloaded (e.g., via /download endpoint), 
// but NOT for files that only exist on the GUI client's machine.
// For remote GUI deployments, quality analysis is done locally in the GUI using whatsmybitrate.
app.post('/analyze', async (req, res) => {
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
  
  const TIDAL_THRESHOLD = 70
  const SOUNDCLOUD_THRESHOLD = 25  // Very permissive - rely on duration check post-download

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
app.post('/search/track', handleTrackSearch)

// GET endpoint (backward compatibility - query params only)
app.get('/search/track', handleTrackSearch)

// ---- Legacy Tidal Search Endpoint (backwards compatibility) ----
app.get('/search/tidal', async (req, res) => {
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
app.post('/resolve', async (req, res) => {
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
app.post('/download-any', async (req, res) => {
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

    // Download from SoundCloud (or original if already SC)
    const result = await downloadTrack(targetUrl, { source, token })

    // Move file from temp to downloads directory
    const filename = path.basename(result.path)
    const destPath = path.join(DOWNLOADS_DIR, filename)
    await fsp.copyFile(result.path, destPath)
    await cleanupTempDir(result.tempDir)

    // Also run quality analysis
    let quality = null
    try {
      quality = await analyzeTrackQuality(destPath, result.metadata || {})
    } catch (err) {
      console.warn('[download-any] Quality analysis failed:', err.message)
    }

    const downloadUrl = `/files/${filename}`

    res.json({
      success: true,
      originalUrl: url,
      resolvedUrl: targetUrl !== url ? targetUrl : null,
      metadata: result.metadata,
      quality,
      filename,
      downloadUrl // Return relative path
    })
  } catch (error) {
    console.error('[download-any] Failed:', error)
    res.status(500).json({ error: error.message })
  }
})

// ---- Start server ----
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Keson Core Server running on port ${PORT}`)
  console.log(`IDHS API: ${config.IDHS_API_BASE_URL}`)
  console.log(`Quality analysis: ${config.ENABLE_QUALITY_ANALYSIS ? 'enabled' : 'disabled'}`)
})
