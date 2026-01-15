'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

// Configuration
const INVITE_BATCH_SIZE = parseInt(process.env.INVITE_BATCH_SIZE) || 25
const DATA_DIR = process.env.AUTH_DATA_DIR || path.join(__dirname, '..', 'data')
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json')

// In-memory state (loaded from file)
let state = {
  invite_code: null,
  registration_count: 0,
  clients: []
}

/**
 * Generate a secure random invite code (6 alphanumeric chars)
 */
function generateInviteCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase()
}

/**
 * Generate a UUID v4 client token
 */
function generateClientToken() {
  return crypto.randomUUID()
}

/**
 * Load state from disk
 */
function loadState() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true })
    }
    
    if (fs.existsSync(CLIENTS_FILE)) {
      const data = fs.readFileSync(CLIENTS_FILE, 'utf8')
      state = JSON.parse(data)
      console.log(`[auth] Loaded ${state.clients.length} registered clients`)
    } else {
      // First run - generate initial invite code
      state.invite_code = generateInviteCode()
      state.registration_count = 0
      state.clients = []
      saveState()
    }
  } catch (err) {
    console.error('[auth] Failed to load state:', err.message)
    // Start fresh
    state.invite_code = generateInviteCode()
    state.registration_count = 0
    state.clients = []
  }
  
  console.log('═══════════════════════════════════════════════════════════')
  console.log(`  🔐 CURRENT INVITE CODE: ${state.invite_code}`)
  console.log(`  📊 Registrations: ${state.registration_count}/${INVITE_BATCH_SIZE}`)
  console.log('═══════════════════════════════════════════════════════════')
}

/**
 * Save state to disk
 */
function saveState() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true })
    }
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(state, null, 2))
  } catch (err) {
    console.error('[auth] Failed to save state:', err.message)
  }
}

/**
 * Rotate to a new invite code
 */
function rotateInviteCode() {
  const oldCode = state.invite_code
  state.invite_code = generateInviteCode()
  state.registration_count = 0
  saveState()
  
  console.log('═══════════════════════════════════════════════════════════')
  console.log(`  🔄 INVITE CODE ROTATED!`)
  console.log(`  ❌ Old: ${oldCode}`)
  console.log(`  ✅ New: ${state.invite_code}`)
  console.log('═══════════════════════════════════════════════════════════')
  
  return state.invite_code
}

/**
 * Register a new client with an invite code
 * @param {string} inviteCode - The invite code provided by user
 * @param {object} clientInfo - Optional info like device_name
 * @returns {string} The client token
 * @throws {Error} If invite code is invalid
 */
function registerClient(inviteCode, clientInfo = {}) {
  if (!inviteCode || inviteCode.toUpperCase() !== state.invite_code) {
    throw new Error('INVALID_INVITE_CODE')
  }
  
  const token = generateClientToken()
  const client = {
    token,
    registered_at: Date.now(),
    device_name: clientInfo.device_name || 'Unknown Device',
    ...clientInfo
  }
  
  state.clients.push(client)
  state.registration_count++
  
  console.log(`[auth] New client registered: ${client.device_name} (${state.registration_count}/${INVITE_BATCH_SIZE})`)
  
  // Check if we need to rotate
  if (state.registration_count >= INVITE_BATCH_SIZE) {
    rotateInviteCode()
  } else {
    saveState()
  }
  
  return token
}

/**
 * Validate a client token
 * @param {string} token - The client token to validate
 * @returns {object|null} The client object if valid, null otherwise
 */
function validateToken(token) {
  if (!token) return null
  return state.clients.find(c => c.token === token) || null
}

/**
 * Get current auth status (for public health check)
 */
function getAuthStatus() {
  return {
    invite_required: true,
    slots_remaining: INVITE_BATCH_SIZE - state.registration_count,
    total_clients: state.clients.length
  }
}

/**
 * Express middleware to validate client token
 * Adds req.client if valid, returns 401 if not
 */
function authMiddleware(req, res, next) {
  const token = req.headers['x-client-token']
  
  if (!token) {
    return res.status(401).json({ 
      error: 'Missing authentication token',
      code: 'AUTH_REQUIRED'
    })
  }
  
  const client = validateToken(token)
  if (!client) {
    return res.status(401).json({ 
      error: 'Invalid or expired token',
      code: 'INVALID_TOKEN'
    })
  }
  
  req.client = client
  next()
}

/**
 * Optional auth middleware - sets req.client if token is valid, but doesn't block
 */
function optionalAuthMiddleware(req, res, next) {
  const token = req.headers['x-client-token']
  if (token) {
    req.client = validateToken(token)
  }
  next()
}

// Initialize on module load
loadState()

module.exports = {
  registerClient,
  validateToken,
  getAuthStatus,
  authMiddleware,
  optionalAuthMiddleware,
  loadState,
  // For testing/admin purposes
  rotateInviteCode,
  getCurrentInviteCode: () => state.invite_code
}
