const express = require('express')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
require('dotenv').config()

const config = require('./config')

const PORT = 8888
// EXACT match is required. User reported "http://localhost:8888" in dashboard.
const REDIRECT_URI = `http://localhost:${PORT}` 
const TOKEN_FILE = path.join(__dirname, '..', 'tidal_tokens.json')

// PKCE Generators
function base64URLEncode(str) {
    return str.toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest();
}

const codeVerifier = base64URLEncode(crypto.randomBytes(32));
const codeChallenge = base64URLEncode(sha256(codeVerifier));

async function runAuth() {
    console.log('--- Manual Tidal Auth (Clean Rebuild) ---')
    
    if (!config.TIDAL_CLIENT_ID) {
        console.error('Error: TIDAL_CLIENT_ID is missing in .env')
        process.exit(1)
    }

    const app = express()
    
    // 1. Authorization Request
    // Endpoint: https://login.tidal.com/authorize (User Interface)
    const authUrl = new URL('https://login.tidal.com/authorize')
    
    // Required Params
    authUrl.searchParams.append('response_type', 'code')
    authUrl.searchParams.append('client_id', config.TIDAL_CLIENT_ID)
    authUrl.searchParams.append('redirect_uri', REDIRECT_URI)
    
    // PKCE Params
    authUrl.searchParams.append('code_challenge_method', 'S256')
    authUrl.searchParams.append('code_challenge', codeChallenge)
    
    // Optional: Scope
    // If omitted, Tidal uses default scopes for the client.
    // Common scopes: 'r_usr', 'w_usr', 'offline_access' (Legacy) or 'user.read' (New)
    // We omit it to minimize 11102 errors (Invalid Scope).
    // authUrl.searchParams.append('scope', 'r_usr w_usr') 

    // NO client_unique_key (Likely cause of 1002 error)

    console.log(`Client ID: ${config.TIDAL_CLIENT_ID}`)
    console.log(`Redirect:  ${REDIRECT_URI}`)
    console.log(`\nOpen this URL in your browser:\n`)
    console.log(authUrl.toString())
    console.log(`\nWaiting for callback on port ${PORT}...`)

    const server = app.listen(PORT, async () => {
        try {
            const { default: open } = await import('open')
            await open(authUrl.toString())
        } catch (e) {
            console.log('Could not open browser automatically. Please copy the URL above.')
        }
    })

    // Handle Redirect (Root path because REDIRECT_URI has no path)
    app.get('/', async (req, res) => {
        const { code, error, error_description } = req.query

        if (error) {
            console.error(`Auth Error: ${error} - ${error_description}`)
            res.send(`<h1>Auth Failed</h1><p>${error}: ${error_description}</p>`)
            server.close()
            return
        }

        if (!code) {
            res.send('<h1>Error</h1><p>No code received.</p>')
            return
        }

        console.log(`\nAuthorization Code Received: ${code.substring(0, 10)}...`)
        console.log('Exchanging code for tokens...')

        try {
            // 2. Token Exchange
            // Endpoint: https://auth.tidal.com/v1/oauth2/token (API)
            const tokenUrl = 'https://auth.tidal.com/v1/oauth2/token'
            
            // Params must be URL encoded form data
            const params = new URLSearchParams()
            params.append('client_id', config.TIDAL_CLIENT_ID)
            params.append('grant_type', 'authorization_code')
            params.append('code', code)
            params.append('redirect_uri', REDIRECT_URI)
            params.append('code_verifier', codeVerifier)
            
            // If Client Secret exists, use it. Some clients are public (no secret).
            if (config.TIDAL_CLIENT_SECRET) {
                params.append('client_secret', config.TIDAL_CLIENT_SECRET)
            }

            // Using dynamic import for axios might be safer or just require it if we know it's CJS compatible. 
            // Core package.json has "axios": "^1.13.2" which is CJS compatible.
            const axios = require('axios')

            const response = await axios.post(tokenUrl, params.toString(), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            })

            console.log('Token exchange successful!')
            const tokens = response.data

            // Save tokens
            fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2))
            console.log(`Tokens saved to: ${TOKEN_FILE}`)
            
            res.send('<h1>Authentication Successful!</h1><p>You can close this window now.</p>')
            
            setTimeout(() => {
                server.close()
                process.exit(0)
            }, 1000)

        } catch (tokenErr) {
            console.error('Token Exchange Failed:')
            if (tokenErr.response) {
                console.error(tokenErr.response.status, tokenErr.response.data)
                res.status(500).send(`Token Exchange Failed: ${JSON.stringify(tokenErr.response.data)}`)
            } else {
                console.error(tokenErr.message)
                res.status(500).send(`Error: ${tokenErr.message}`)
            }
            // Keep server open in case of retry or inspection
        }
    })
}

runAuth()
