'use strict'

const axios = require('axios')
const fs = require('fs')
const path = require('path')
const config = require('./config')

const TOKEN_FILE = path.join(__dirname, '..', 'tidal_tokens.json')

// Debug: Log token file path
console.log('[tidal] TOKEN_FILE path:', TOKEN_FILE)

// Check for tokens injected via ENV (e.g. from Portainer) and write to file
if (process.env.TIDAL_TOKEN_JSON) {
    console.log('[tidal] Found TIDAL_TOKEN_JSON in environment (length:', process.env.TIDAL_TOKEN_JSON.length, ')')
    try {
        let jsonString = process.env.TIDAL_TOKEN_JSON.trim()
        
        // Check if it's base64 encoded (doesn't start with '{')
        if (!jsonString.startsWith('{')) {
            console.log('[tidal] TIDAL_TOKEN_JSON appears to be base64 encoded, decoding...')
            jsonString = Buffer.from(jsonString, 'base64').toString('utf8')
            console.log('[tidal] Decoded JSON starts with:', jsonString.substring(0, 20))
        }
        
        const tokens = JSON.parse(jsonString)
        console.log('[tidal] Parsed TIDAL_TOKEN_JSON keys:', Object.keys(tokens))
        fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2))
        console.log('[tidal] Token file written successfully.')
    } catch (e) {
        console.error('[tidal] Failed to parse TIDAL_TOKEN_JSON from env:', e.message)
    }
} else {
    console.log('[tidal] TIDAL_TOKEN_JSON not set in environment.')
}

// Debug: Check if token file exists after potential ENV write
console.log('[tidal] Token file exists:', fs.existsSync(TOKEN_FILE))

let accessToken = null
let tokenExpiresAt = 0

/**
 * Refresh the access token using the refresh token
 */
async function refreshAccessToken(creds) {
    // Support both 'refreshToken' (SDK) and 'refresh_token' (standard OAuth)
    const refreshToken = creds.refreshToken || creds.refresh_token
    if (!refreshToken) return null
    if (!config.TIDAL_CLIENT_ID || !config.TIDAL_CLIENT_SECRET) {
        console.error('[tidal] Cannot refresh token: Missing Client ID/Secret')
        return null
    }

    try {
        console.log('[tidal] Refreshing access token...')
        // Use standard OAuth 2.0 token endpoint for Tidal
        const authString = Buffer.from(`${config.TIDAL_CLIENT_ID}:${config.TIDAL_CLIENT_SECRET}`).toString('base64')
        
        const response = await axios.post('https://auth.tidal.com/v1/oauth2/token', 
            new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken
            }), 
            {
                headers: {
                    'Authorization': `Basic ${authString}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        )

        const newTokens = response.data
        // Standardize response to match what we save
        const updatedCreds = {
            ...creds,
            token: newTokens.access_token,
            refreshToken: newTokens.refresh_token || creds.refreshToken, // Sometimes refresh token rotates
            expires: Date.now() + (newTokens.expires_in * 1000)
        }

        fs.writeFileSync(TOKEN_FILE, JSON.stringify(updatedCreds, null, 2))
        console.log('[tidal] Token refreshed and saved.')
        return updatedCreds.token

    } catch (e) {
        console.error('[tidal] Token refresh failed:', e.response?.data || e.message)
        return null
    }
}

/**
 * Get a valid access token (User Auth Flow)
 */
async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiresAt) {
    console.log('[tidal] Using cached token (valid until', new Date(tokenExpiresAt).toISOString(), ')')
    return accessToken
  }

  // Load from file if not loaded
  console.log('[tidal] getAccessToken: Checking TOKEN_FILE:', TOKEN_FILE)
  console.log('[tidal] getAccessToken: File exists:', fs.existsSync(TOKEN_FILE))
  
  if (fs.existsSync(TOKEN_FILE)) {
      try {
          const fileContent = fs.readFileSync(TOKEN_FILE, 'utf8')
          console.log('[tidal] getAccessToken: File content length:', fileContent.length)
          
          const creds = JSON.parse(fileContent)
          console.log('[tidal] getAccessToken: Parsed keys:', Object.keys(creds))
          
          // Support both 'token' (SDK format) and 'access_token' (standard OAuth format)
          const tokenValue = creds.token || creds.access_token
          console.log('[tidal] getAccessToken: tokenValue found:', !!tokenValue, tokenValue ? `(${tokenValue.substring(0, 20)}...)` : '')
          
          if (tokenValue) {
              // Check expiry
              // Default buffer of 5 minutes
              const expiresAt = creds.expires || (creds.expires_in ? Date.now() + (creds.expires_in * 1000) : 0)
              const isExpired = !expiresAt || Date.now() > (expiresAt - 300000)
              console.log('[tidal] getAccessToken: expiresAt:', expiresAt, 'isExpired:', isExpired)
              
              if (isExpired) {
                  console.log('[tidal] Token expired or expiring soon.')
                  const newToken = await refreshAccessToken(creds)
                  if (newToken) {
                      accessToken = newToken
                      tokenExpiresAt = Date.now() + 3600 * 1000
                      return accessToken
                  }
                  console.warn('[tidal] Refresh failed. Please re-login.')
                  return null
              }

              accessToken = tokenValue
              tokenExpiresAt = expiresAt
              console.log('[tidal] getAccessToken: Token loaded successfully!')
              return accessToken
          } else {
              console.log('[tidal] getAccessToken: No token or access_token key found in creds')
          }
      } catch (e) {
          console.error('[tidal] Error reading token file:', e.message)
      }
  }
  
  console.log('[tidal] No valid user token found. Run `npm run auth-tidal` to login.')
  return null
}

/**
 * Search for tracks on Tidal by ISRC (International Standard Recording Code)
 * @param {string} isrc - The ISRC code
 * @returns {Promise<Array>} Array of matching tracks
 */
async function searchByIsrc(isrc) {
  if (!isrc) return []
  
  try {
    const token = await getAccessToken()
    if (!token) return []

    const countryCode = config.TIDAL_COUNTRY_CODE
    const searchUrl = `https://openapi.tidal.com/v2/tracks`
    
    console.log(`[tidal] ISRC search: ${isrc}`)
    
    const response = await axios.get(searchUrl, {
      params: {
        'filter[isrc]': isrc,
        countryCode
      },
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.api+json'
      }
    })

    const tracks = response.data?.data || []
    return tracks.map(parseTrackData)
    
  } catch (error) {
    console.warn('[tidal] ISRC search failed:', error.message)
    return []
  }
}

/**
 * Search for tracks on Tidal by query string
 * Returns multiple candidates for scoring
 * @param {Object} metadata - { artist, title, isrc }
 * @returns {Promise<Array>} Array of candidate tracks
 */
async function searchTracks(metadata) {
  // First try ISRC search if available (perfect match)
  if (metadata.isrc) {
    const isrcResults = await searchByIsrc(metadata.isrc)
    if (isrcResults.length > 0) {
      console.log(`[tidal] Found ${isrcResults.length} ISRC match(es)`)
      return isrcResults
    }
  }
  
  // Fall back to text search
  const query = buildQuery(metadata)
  if (!query) {
    console.warn('[tidal] Empty search query')
    return []
  }

  try {
    const token = await getAccessToken()
    if (!token) return []

    const countryCode = config.TIDAL_COUNTRY_CODE
    const encodedQuery = encodeURIComponent(query)
    const searchUrl = `https://openapi.tidal.com/v2/searchResults/${encodedQuery}`
    
    console.log(`[tidal] Searching: ${query}`)
    
    const response = await axios.get(searchUrl, {
      params: {
        countryCode,
        include: 'tracks.artists,tracks.albums'
      },
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.api+json'
      }
    })

    // Extract tracks from included array (JSON:API format)
    const included = response.data?.included || []
    const tracks = included
      .filter(i => i.type === 'tracks')
      .slice(0, 10) // Top 10 results
      .map(track => parseTrackData(track, included))
    
    console.log(`[tidal] Found ${tracks.length} candidates`)
    
    // Debug: Check included types
    const types = new Set(included.map(i => i.type))
    console.log(`[tidal] Included types: ${Array.from(types).join(', ')}`)
    
    return tracks
    
  } catch (error) {
    if (error.response?.status === 401) {
      console.warn('[tidal] Auth failed (401). Token may be expired.')
    } else {
      console.warn('[tidal] Search error:', error.response?.status || error.message)
    }
    return []
  }
}

/**
 * Parse track data from Tidal API response
 */
function parseTrackData(track, included = []) {
  const attrs = track.attributes || {}
  
  // Parse duration from ISO 8601 (PT3M35S) to seconds
  let duration = null
  if (attrs.duration) {
    const match = attrs.duration.match(/PT(\d+M)?(\d+(\.\d+)?S)?/)
    if (match) {
      const minutes = match[1] ? parseFloat(match[1]) : 0
      const seconds = match[2] ? parseFloat(match[2]) : 0
      duration = (minutes * 60) + seconds
    }
  }

  // extract artist name
  let artistName = 'Unknown'
  
  // 1. Try direct attribute
  if (attrs.artistName) {
    artistName = attrs.artistName
  } 
  // 2. Try nested artists array in attributes
  else if (attrs.artists && attrs.artists.length > 0) {
    artistName = attrs.artists[0].name
  }
  // 3. Try relationships -> included lookups
  else if (track.relationships && track.relationships.artists && track.relationships.artists.data && track.relationships.artists.data.length > 0) {
    const artistId = track.relationships.artists.data[0].id
    const artistObj = included.find(i => i.type === 'artists' && i.id === artistId)
    
    if (artistObj && artistObj.attributes) {
      artistName = artistObj.attributes.name
    }
  }

  // Extract Cover Art
  let coverUrl = null
  let albumId = null
  
  // Check singular 'album' or plural 'albums'
  const rels = track.relationships || {}
  const albumRel = rels.album || rels.albums
  
  if (albumRel?.data) {
     if (Array.isArray(albumRel.data) && albumRel.data.length > 0) {
        albumId = albumRel.data[0].id
     } else if (albumRel.data.id) {
        albumId = albumRel.data.id
     }
  }
  
  if (albumId && included.length > 0) {
     const albumObj = included.find(i => i.type === 'albums' && i.id === albumId)
     if (albumObj) {
        // Try 'cover' or 'imageCover' (Tidal API varies)
        const coverUuid = albumObj.attributes?.cover || albumObj.attributes?.imageCover
        if (coverUuid) {
            coverUrl = `https://resources.tidal.com/images/${coverUuid.replace(/-/g, '/')}/640x640.jpg`
        } else {
             console.log(`[tidal] Album found (${albumId}) but no cover attribute. Available attrs:`, Object.keys(albumObj.attributes || {}))
        }
     } else {
        console.log(`[tidal] Album ID ${albumId} not found in included`)
     }
  } else {
      console.log(`[tidal] No album relationship found for track ${track.id}`)
  }

  return {
    id: track.id,
    title: attrs.title || 'Unknown',
    artist: artistName,
    duration: duration,
    isrc: attrs.isrc || null,
    url: `https://tidal.com/browse/track/${track.id}`,
    cover_url: coverUrl
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
 * Clean string for search query
 */
function cleanForSearch(str) {
  if (!str) return ''
  
  return str
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/\s*\[.*?\]\s*/g, ' ')
    .replace(/feat\..*/i, '')
    .replace(/ft\..*/i, '')
    .split(' - ')[0]                  // Keep only first part before " - "
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Legacy function for backwards compatibility
 * Returns first match URL or null
 */
async function searchTrack(query) {
  const metadata = typeof query === 'string' 
    ? { title: query }
    : query
    
  const results = await searchTracks(metadata)
  
  if (results.length > 0) {
    const best = results[0]
    console.log(`[tidal] Found match: "${best.title}" (${best.url})`)
    return best.url
  }
  
  console.log(`[tidal] No match found`)
  return null
}

module.exports = {
  searchTrack,       // Legacy - returns first URL
  searchTracks,      // New - returns multiple candidates
  searchByIsrc,      // ISRC search
  getAccessToken     // Expose for other modules if needed
}

