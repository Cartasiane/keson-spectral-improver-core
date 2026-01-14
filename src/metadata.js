'use strict'

const { spawn } = require('child_process')
const path = require('path')
const config = require('./config')

/**
 * Extract metadata from an audio file using ffprobe
 * Returns: { artist, title, album, isrc, duration, source }
 */
async function extractMetadata(filePath) {
  const result = {
    artist: null,
    title: null,
    album: null,
    isrc: null,
    duration: null,
    source: 'unknown' // 'id3', 'filename', 'none'
  }

  // 1. Try ffprobe for tags
  try {
    const tags = await probeFileTags(filePath)
    if (tags.artist && tags.title) {
      result.artist = tags.artist
      result.title = tags.title
      result.album = tags.album || null
      result.isrc = tags.isrc || tags.ISRC || null
      result.source = 'id3'
    }
    result.duration = tags.duration || null
  } catch (e) {
    console.warn('[metadata] ffprobe failed:', e.message)
  }

  // 2. Fallback: parse filename
  if (!result.artist || !result.title) {
    const parsed = parseFilename(path.basename(filePath))
    result.artist = result.artist || parsed.artist
    result.title = result.title || parsed.title
    if (result.source !== 'id3') {
      result.source = parsed.artist ? 'filename' : 'none'
    }
  }

  // 3. Get duration if not already obtained
  if (!result.duration) {
    try {
      result.duration = await probeDuration(filePath)
    } catch (e) {
      console.warn('[metadata] Duration probe failed:', e.message)
    }
  }

  return result
}

/**
 * Probe audio file for ID3/metadata tags using ffprobe
 */
async function probeFileTags(filePath) {
  const ffprobePath = config.FFPROBE_PATH || 'ffprobe'
  
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ]

    const proc = spawn(ffprobePath, args)
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => { stdout += data })
    proc.stderr.on('data', (data) => { stderr += data })

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`ffprobe exited with code ${code}: ${stderr}`))
      }

      try {
        const data = JSON.parse(stdout)
        const format = data.format || {}
        const tags = format.tags || {}

        // Normalize tag keys (case-insensitive)
        const normalizedTags = {}
        for (const [key, value] of Object.entries(tags)) {
          normalizedTags[key.toLowerCase()] = value
        }

        resolve({
          artist: normalizedTags.artist || normalizedTags.album_artist || null,
          title: normalizedTags.title || null,
          album: normalizedTags.album || null,
          isrc: normalizedTags.isrc || normalizedTags.tsrc || null,
          duration: format.duration ? parseFloat(format.duration) : null
        })
      } catch (e) {
        reject(new Error(`Failed to parse ffprobe output: ${e.message}`))
      }
    })

    proc.on('error', reject)
  })
}

/**
 * Probe just the duration of an audio file
 */
async function probeDuration(filePath) {
  const ffprobePath = config.FFPROBE_PATH || 'ffprobe'
  
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      filePath
    ]

    const proc = spawn(ffprobePath, args)
    let stdout = ''

    proc.stdout.on('data', (data) => { stdout += data })
    
    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`ffprobe exited with code ${code}`))
      }

      try {
        const data = JSON.parse(stdout)
        resolve(parseFloat(data.format?.duration) || null)
      } catch (e) {
        reject(e)
      }
    })

    proc.on('error', reject)
  })
}

/**
 * Parse artist and title from filename
 * Handles various common formats
 */
function parseFilename(filename) {
  // Remove extension
  const name = filename.replace(/\.[^.]+$/, '')
  
  // Common patterns to try
  const patterns = [
    // "[Tag] Artist - Title" or "[Tag] Title - Artist"
    /^\[.*?\]\s*(.+?)\s*-\s*(.+)$/,
    // "Artist - Title"
    /^(.+?)\s*-\s*(.+)$/,
    // "Artist_Title" (underscore separator)
    /^(.+?)_(.+)$/,
  ]

  for (const pattern of patterns) {
    const match = name.match(pattern)
    if (match) {
      const [, part1, part2] = match
      
      // Heuristic: if part2 looks more like an artist name (shorter, capitalized)
      // and part1 is longer, swap them
      const p1Clean = part1.replace(/^\[.*?\]\s*/, '').trim()
      const p2Clean = part2.trim()
      
      // Default: assume "Artist - Title" format
      return {
        artist: p1Clean,
        title: p2Clean
      }
    }
  }

  // No separator found - use entire name as title
  return {
    artist: null,
    title: name.trim()
  }
}

/**
 * Build a search query string from metadata
 */
function buildSearchQuery(metadata) {
  const parts = []
  
  if (metadata.artist) {
    parts.push(simplifyForSearch(metadata.artist))
  }
  
  if (metadata.title) {
    parts.push(simplifyForSearch(metadata.title))
  }
  
  return parts.join(' ')
}

/**
 * Simplify a string for search purposes
 * Removes common suffixes, extra info, and normalizes
 */
function simplifyForSearch(str) {
  if (!str) return ''
  
  return str
    .replace(/\s*\(.*?\)\s*/g, ' ')  // Remove parenthesized content
    .replace(/\s*\[.*?\]\s*/g, ' ')  // Remove bracketed content
    .replace(/\s*-\s*$/, '')         // Remove trailing dash
    .replace(/feat\..*$/i, '')       // Remove "feat." and after
    .replace(/ft\..*$/i, '')         // Remove "ft." and after
    .replace(/\s+/g, ' ')            // Normalize whitespace
    .trim()
}

module.exports = {
  extractMetadata,
  probeFileTags,
  probeDuration,
  parseFilename,
  buildSearchQuery,
  simplifyForSearch
}
