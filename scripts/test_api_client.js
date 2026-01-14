const fs = require('fs');
const path = require('path');
const { createAPIClient } = require('@tidal-music/api');

const TOKEN_FILE = path.join(__dirname, '..', 'tidal_tokens.json');

async function test() {
    try {
        if (!fs.existsSync(TOKEN_FILE)) {
            console.log("No token file");
            return;
        }
        const creds = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
        
        // Auth Provider Adapter
        const authProvider = {
            getCredentials: () => Promise.resolve(creds)
        };
        
        const client = createAPIClient(authProvider);
        
        console.log("Testing client.GET('/search')...");
        
        // Try simple search with JSON:API filter
        try {
            const query = "Daft Punk";
            console.log("Testing client.GET('/tracks')...");
            // Note: filter[text] might not be supported on /tracks? But worth trying.
            const res = await client.GET(`/tracks?filter[name]=${encodeURIComponent(query)}&page[limit]=1`);
            console.log("Result Keys:", Object.keys(res));
            console.log("Error:", res.error);
            console.log("Data:", JSON.stringify(res.data, null, 2));
            console.log("Response Status:", res.response?.status);
            console.log("Response URL:", res.response?.url);
            
            if (res.response && typeof res.response.text === 'function') {
                 // It might be a fetch Response
                 if (!res.data) {
                     console.log("Body text:", await res.response.text());
                 }
            }
        } catch (e) {
            console.error("GET /search failed:", e.message);
            if (e.response) {
                console.error("Status:", e.response.status);
                // console.error("Body:", await e.response.text()); // fetch response?
            }
        }
        
    } catch (e) {
        console.error("Test failed:", e);
    }
}

test();
