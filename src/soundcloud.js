'use strict'

const { spawn } = require('child_process')
const config = require('./config')

/**
 * Search SoundCloud for tracks matching metadata
 * Uses yt-dlp to extract search results
 * @param {Object} metadata - { artist, title }
 * @returns {Promise<Array>} Array of candidate tracks
 */
async function searchSoundCloud(metadata) {
  const query = buildQuery(metadata)
  
  if (!query) {
    console.warn('[soundcloud] Empty search query')
    return []
  }

  const ytdlpPath = config.YT_DLP_BINARY_PATH || 'yt-dlp'

  try {
    console.log(`[soundcloud] Searching: ${query}`)
    
    // Use yt-dlp's search feature - get top 5 results
    const { stdout, stderr } = await spawnCollect(ytdlpPath, [
      `scsearch5:${query}`,      // Search top 5 results on SoundCloud
      '--dump-json',
      '--no-download',
      '--socket-timeout', '15'
    ])

    if (!stdout.trim()) {
      console.log('[soundcloud] No results found')
      return []
    }

    // Parse JSON lines (one per result)
    const lines = stdout.trim().split('\n').filter(l => l.trim())
    const results = []
    
    for (const line of lines) {
      try {
        const data = JSON.parse(line)
        results.push({
          id: data.id,
          title: data.title || data.fulltitle || 'Unknown',
          artist: data.uploader || data.channel || data.creator || 'Unknown',
          duration: data.duration || null,
          url: data.webpage_url || data.url,
          cover_url: data.thumbnail || null
        })
        if (!data.thumbnail) console.log('[soundcloud] No thumbnail in result:', data.id)
      } catch (e) {
        console.warn('[soundcloud] Failed to parse result:', e.message)
      }
    }

    console.log(`[soundcloud] Found ${results.length} results`)
    return results

  } catch (e) {
    console.error('[soundcloud] Search failed:', e.message)
    return []
  }
}

/**
 * Build search query from metadata
 */
function buildQuery(metadata) {
  const parts = []
  
  if (metadata.artist) {
    parts.push(cleanForSearch(metadata.artist))
  }
  
  if (metadata.title) {
    parts.push(cleanForSearch(metadata.title))
  }
  
  return parts.join(' ')
}

/**
 * Clean string for search
 */
function cleanForSearch(str) {
  if (!str) return ''
  
  return str
    .replace(/\s*\(.*?\)\s*/g, ' ')  // Remove parenthetical
    .replace(/\s*\[.*?\]\s*/g, ' ')  // Remove brackets
    .replace(/feat\..*/i, '')        // Remove featuring
    .replace(/ft\..*/i, '')
    .split(' - ')[0]                  // Keep only first part before " - "
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Spawn a command and collect output
 */
function spawnCollect(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      ...options,
      timeout: 30000 // 30 second timeout
    })
    
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => { stdout += data })
    proc.stderr.on('data', (data) => { stderr += data })

    proc.on('close', (code) => {
      if (code !== 0 && code !== null) {
        return reject(new Error(`${cmd} exited with code ${code}: ${stderr}`))
      }
      resolve({ stdout, stderr })
    })

    proc.on('error', reject)
    
    // Handle timeout
    setTimeout(() => {
      try {
        proc.kill('SIGTERM')
      } catch (e) {
        // Ignore kill errors
      }
    }, 30000)
  })
}

module.exports = {
  searchSoundCloud
}
