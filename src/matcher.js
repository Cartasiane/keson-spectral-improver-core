'use strict'

/**
 * Match scoring weights
 */
const WEIGHTS = {
  DURATION: 40,
  TITLE: 30,
  ARTIST: 30,
  PENALTY_VERSION_MISMATCH: -100
}

/**
 * Calculate a match score between source metadata and a candidate track
 * @param {Object} source - Source file metadata { artist, title, duration }
 * @param {Object} candidate - Candidate track { artist, title, duration }
 * @returns {number} Score from 0-100 (can be negative with penalties)
 */
function scoreMatch(source, candidate) {
  let score = 0

  // Duration match (±2 seconds = full points, ±5 seconds = half points)
  if (source.duration && candidate.duration) {
    const diff = Math.abs(source.duration - candidate.duration)
    if (diff <= 2) {
      score += WEIGHTS.DURATION
    } else if (diff <= 5) {
      score += WEIGHTS.DURATION / 2
    }
    // No points if difference > 5 seconds
  } else {
    // If we can't compare duration, give partial credit
    score += WEIGHTS.DURATION / 4
  }

  // Title similarity (fuzzy match)
  if (source.title && candidate.title) {
    const titleSim = fuzzyMatch(
      simplify(source.title),
      simplify(candidate.title)
    )
    score += titleSim * WEIGHTS.TITLE
  }

  // Artist overlap
  if (source.artist && candidate.artist) {
    if (artistsOverlap(source.artist, candidate.artist)) {
      score += WEIGHTS.ARTIST
    }
  } else {
    // If we don't have artist info, give partial credit
    score += WEIGHTS.ARTIST / 4
  }

  // Exclusion rules (version mismatch)
  if (source.title && candidate.title) {
    if (versionMismatch(source.title, candidate.title)) {
      score += WEIGHTS.PENALTY_VERSION_MISMATCH
    }
  }

  return Math.max(0, score) // Don't go below 0
}

/**
 * Simplify string for comparison
 * Removes common suffixes, parenthetical content, etc.
 */
function simplify(str) {
  if (!str) return ''
  
  return str
    .toLowerCase()
    .split('-')[0]
    .split('(')[0]
    .split('[')[0]
    .replace(/feat\./gi, '')
    .replace(/ft\./gi, '')
    .replace(/&/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Fuzzy string matching
 * Returns similarity ratio between 0 and 1
 */
function fuzzyMatch(a, b) {
  if (!a || !b) return 0
  
  const strA = a.toLowerCase()
  const strB = b.toLowerCase()
  
  // Exact match
  if (strA === strB) return 1
  
  // One contains the other
  if (strA.includes(strB) || strB.includes(strA)) {
    const shorter = Math.min(strA.length, strB.length)
    const longer = Math.max(strA.length, strB.length)
    return shorter / longer
  }
  
  // Levenshtein-based similarity
  const distance = levenshteinDistance(strA, strB)
  const maxLen = Math.max(strA.length, strB.length)
  return 1 - (distance / maxLen)
}

/**
 * Levenshtein distance between two strings
 */
function levenshteinDistance(a, b) {
  const matrix = []

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        )
      }
    }
  }

  return matrix[b.length][a.length]
}

/**
 * Check if artists have at least one name in common
 * Handles multiple artists separated by various delimiters
 */
function artistsOverlap(artistA, artistB) {
  const setA = normalizeArtists(artistA)
  const setB = normalizeArtists(artistB)
  
  for (const a of setA) {
    for (const b of setB) {
      // Check for exact match or one contains the other
      if (a === b || a.includes(b) || b.includes(a)) {
        return true
      }
    }
  }
  
  return false
}

/**
 * Split artist string into normalized set of individual artists
 */
function normalizeArtists(artistStr) {
  if (!artistStr) return new Set()
  
  // Split on common delimiters
  const artists = artistStr
    .split(/[,&]|feat\.?|ft\.?|\s+and\s+/i)
    .map(a => simplify(a))
    .filter(a => a.length > 0)
  
  return new Set(artists)
}

/**
 * Check for version/remix mismatch between source and candidate
 * Returns true if there's a significant mismatch
 */
function versionMismatch(sourceTitle, candidateTitle) {
  const patterns = [
    'remix',
    'instrumental',
    'acapella',
    'a cappella',
    'live',
    'acoustic',
    'radio edit',
    'extended',
    'original mix',
    'club mix',
    'dub mix'
  ]
  
  const srcLower = sourceTitle.toLowerCase()
  const candLower = candidateTitle.toLowerCase()
  
  for (const pattern of patterns) {
    const inSource = srcLower.includes(pattern)
    const inCandidate = candLower.includes(pattern)
    
    // Mismatch: one has the pattern, the other doesn't
    if (inSource !== inCandidate) {
      return true
    }
  }
  
  return false
}

module.exports = {
  scoreMatch,
  simplify,
  fuzzyMatch,
  artistsOverlap,
  versionMismatch,
  WEIGHTS
}
