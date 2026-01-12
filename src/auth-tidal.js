'use strict'

const express = require('express')
const auth = require('@tidal-music/auth')

const fs = require('fs')
const path = require('path')
const config = require('./config')

const PORT = 8888 
// No longer need express server or open for simple device flow, but let's keep open for convenience to open the link
const REDIRECT_URI = `http://localhost:${PORT}/callback`
const TOKEN_FILE = path.join(__dirname, '..', 'tidal_tokens.json')

// Polyfill for Tidal Auth SDK requirements in Node.js
const { LocalStorage } = require('node-localstorage')
const localStorage = new LocalStorage('./tidal-local-storage-scratch')
global.localStorage = localStorage

if (typeof global.window === 'undefined') {
    global.window = {
        location: {
            origin: `http://localhost:${PORT}`
        },
        localStorage: localStorage
    }
}
if (typeof global.CustomEvent === 'undefined') {
    global.CustomEvent = class CustomEvent extends Event {
        constructor(message, data) {
            super(message, data)
            this.detail = data.detail
        }
    }
}
if (typeof global.dispatchEvent === 'undefined') {
    global.dispatchEvent = () => true
}


async function runAuth() {
  if (!config.TIDAL_CLIENT_ID || !config.TIDAL_CLIENT_SECRET) {
    console.error('Error: TIDAL_CLIENT_ID and TIDAL_CLIENT_SECRET must be set in .env')
    process.exit(1)
  }
  console.log(`Using Client ID: ${config.TIDAL_CLIENT_ID.substring(0, 4)}...`)
  
  // Clear storage to start fresh
  localStorage.clear()

  // Initialize Tidal Auth
  await auth.init({
    clientId: config.TIDAL_CLIENT_ID,
    clientSecret: config.TIDAL_CLIENT_SECRET,
    scopes: ['user.read'],
    credentialsStorageKey: 'tidalsdk_auth',
    storage: localStorage,
    credentialsStorage: {
        async getCredentials() {
             if (fs.existsSync(TOKEN_FILE)) {
                 try {
                     return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'))
                 } catch (e) {
                     console.error('Error reading token file:', e)
                     return null
                 }
             }
             return null
        },
        async saveCredentials(creds) {
            fs.writeFileSync(TOKEN_FILE, JSON.stringify(creds, null, 2))
            console.log(`\nTokens saved to ${TOKEN_FILE}`)
            console.log('Saved keys:', Object.keys(creds))
            if (creds.codeChallenge) console.log('codeChallenge is present in saved credentials')
            else console.warn('WARNING: codeChallenge MISSING in saved credentials')
        },
        async deleteCredentials() {
            if(fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE)
        }
    }
  })

  const app = express()

  // Start server
  const server = app.listen(PORT, async () => {
    console.log(`\nLocal server running on port ${PORT}`)
    
    // Generate Login URL
    const loginUrl = await auth.initializeLogin({
      redirectUri: REDIRECT_URI
    })

    console.log(`\nOpening browser for login: ${loginUrl}`)
    
    // open is an ESM module in recent versions, use dynamic import
    const openModule = await import('open')
    await openModule.default(loginUrl)
  })

  // Callback Handler
  app.get('/callback', async (req, res) => {
    const { code, state } = req.query
    
    if (!code) {
        res.send('Error: check console')
        return
    }

    try {
      console.log('Received auth code, finalizing login...')
      // finalizeLogin expects a query string (e.g. ?code=...)
      // req.url is /callback?code=... so we extract the search part
      const searchParams = req.url.split('?')[1]
      await auth.finalizeLogin(`?${searchParams}`)
      
      console.log('FinalizeLogin complete. Fetching credentials from provider...')
      const credentials = await auth.credentialsProvider.getCredentials()
      
      console.log('Saving credentials explicitly...')
      fs.writeFileSync(TOKEN_FILE, JSON.stringify(credentials, null, 2))
      console.log(`Tokens saved to ${TOKEN_FILE}`)
      console.log('Saved keys:', Object.keys(credentials || {}))
      
      res.send('<h1>Login Successful!</h1><p>You can close this window and return to the terminal.</p>')
      console.log('Login successful!')
      
      setTimeout(() => {
          server.close()
          process.exit(0)
      }, 1000)

    } catch (err) {
      console.error('Login failed:', err)
      console.error('Error details:', JSON.stringify(err, null, 2))
      res.status(500).send(`Login failed: ${err.message || err.errorCode} (See console for details)`)
    }
  })
}

runAuth().catch(err => console.error(err))
