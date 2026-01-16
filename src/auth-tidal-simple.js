const express = require('express')
const axios = require('axios')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
// open is ESM only, will be imported dynamically
require('dotenv').config()

const config = require('./config')

const PORT = 8888
const REDIRECT_URI = `http://localhost:${PORT}`  // Changed to exact match (no trailing slash)

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
    if (!config.TIDAL_CLIENT_ID || !config.TIDAL_CLIENT_SECRET) {
        console.error('Error: TIDAL_CLIENT_ID and TIDAL_CLIENT_SECRET must be set in .env')
        process.exit(1)
    }

    const app = express()
    
    // Construct Auth URL manually
    // ERROR FIX: Use login.tidal.com for the user-facing page, NOT auth.tidal.com
    const authUrl = new URL('https://login.tidal.com/authorize')
    authUrl.searchParams.append('response_type', 'code')
    authUrl.searchParams.append('client_id', config.TIDAL_CLIENT_ID)
    authUrl.searchParams.append('redirect_uri', REDIRECT_URI)
    authUrl.searchParams.append('scope', 'r_usr') 
    authUrl.searchParams.append('code_challenge_method', 'S256')
    authUrl.searchParams.append('code_challenge', codeChallenge)
    authUrl.searchParams.append('client_unique_key', 'keson-core')

    console.log(`\n=== Tidal Auth (Simple) ===`)
    console.log(`Client ID: ${config.TIDAL_CLIENT_ID.substring(0, 4)}...`)
    console.log(`Open this URL to login:\n\n${authUrl.toString()}\n`)

    const server = app.listen(PORT, async () => {
        console.log(`Server listening on ${PORT}...`)
        const { default: open } = await import('open')
        await open(authUrl.toString())
    })

    app.get('/', async (req, res) => {
        const { code } = req.query

        if (!code) {
            res.send('Error: check console')
            return
        }

        try {
            console.log('Received code, exchanging for token...')
            
            const params = new URLSearchParams()
            params.append('client_id', config.TIDAL_CLIENT_ID)
            params.append('client_secret', config.TIDAL_CLIENT_SECRET)
            params.append('code', code)
            params.append('grant_type', 'authorization_code')
            params.append('redirect_uri', REDIRECT_URI)
            params.append('code_verifier', codeVerifier)
            // client_id and client_secret in body for standard web app flow if basic auth fails.
            // Tidal documentation varies, but usually PKCE clients are public (no secret).
            // However, this client ID seems to be a web one requiring a secret.

            const response = await axios.post('https://auth.tidal.com/v1/oauth2/token', params.toString(), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            })

            const tokens = response.data
            
            // Format for compatibility with our app
            // The SDK expects keys like 'accessToken', 'refreshToken', 'expiresIn' (camelCase)
            // But Tidal API returns snake_case. Let's normalize just in case, or save as is and let app handle it.
            // Looking at auth-tidal.js, SDK saves whatever it gets.
            // Tidal API returns: access_token, refresh_token, token_type, expires_in, scope
            
            // We'll map them to be safe if the SDK uses camelCase, but usually standard OAuth libs handle snake_case.
            // Let's perform a simple mapping to match what typical JS SDKs expects if needed, 
            // but for now saving the raw response is safest plus camelCase versions.
            
            const savedTokens = {
                ...tokens,
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                expiresIn: tokens.expires_in,
                scope: tokens.scope,
                tokenType: tokens.token_type
            }

            fs.writeFileSync(TOKEN_FILE, JSON.stringify(savedTokens, null, 2))
            console.log(`\nSuccess! Tokens saved to ${TOKEN_FILE}`)
            
            res.send('<h1>Login Successful!</h1><p>Tokens saved. You can close this.</p>')
            
            setTimeout(() => {
                server.close()
                process.exit(0)
            }, 1000)

        } catch (err) {
            console.error('Token exchange failed:', err.response ? err.response.data : err.message)
            res.status(500).send('Login failed, checks logs.')
        }
    })
}

runAuth()
