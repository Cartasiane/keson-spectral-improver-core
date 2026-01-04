'use strict'

const express = require('express')
const path = require('path')
const fs = require('fs')
const fsp = require('fs/promises')
const os = require('os')

const { downloadTrack, cleanupTempDir } = require('./downloader')
const { analyzeTrackQuality } = require('./quality')
const { isIdhsSupportedLink, resolveLinkViaIdhs } = require('./idhs')
const config = require('./config')

const app = express()
const PORT = process.env.PORT || 3001
const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR || path.join(os.tmpdir(), 'keson-downloads')

// Ensure downloads directory exists
fs.mkdirSync(DOWNLOADS_DIR, { recursive: true })

app.use(express.json())

// Serve downloaded files
app.use('/files', express.static(DOWNLOADS_DIR))

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
      downloadUrl: `http://localhost:${PORT}${downloadUrl}`
    })
  } catch (error) {
    console.error('[download] Failed:', error)
    res.status(500).json({ error: error.message })
  }
})

// ---- Analyze Quality ----
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
    if (isIdhsSupportedLink(url)) {
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
      downloadUrl: `http://localhost:${PORT}${downloadUrl}`
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
