const fs = require('fs');
const path = require('path');
const { createAPIClient } = require('@tidal-music/api');

const TOKEN_FILE = path.join(__dirname, 'tidal_tokens.json');

async function test() {
    try {
        if (!fs.existsSync(TOKEN_FILE)) return;
        const creds = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
        const client = createAPIClient({ getCredentials: () => Promise.resolve(creds) });
        
        const paths = [
            '/search',
            '/searchResults',
            '/search-results',
            '/catalog/search',
            '/catalog/searchResults',
            '/catalog/search-results',
            '/tracks', // we know this is 400
        ];
        
        const query = "Daft Punk";
        const params = {
            'filter[text]': query,
            'page[limit]': 1
        };

        const filters = ['text', 'name', 'title', 'query', 'description', 'all'];
        
        for (const f of filters) {
            try {
                // Try /tracks with different filters
                let res = await client.GET(`/tracks?filter[${f}]=${encodeURIComponent(query)}&page[limit]=1`);
                console.log(`/tracks?filter[${f}]:`, res.response?.status);
            } catch (e) {
                 console.log(`/tracks?filter[${f}]:`, e.response?.status || e.message);
                 // if (e.response.status === 400) console.log(await e.response.text());
            }
        }
        
    } catch (e) {
        console.error(e);
    }
}
test();
