const { smartDownload } = require('./src/downloader');
const { searchTrack } = require('./src/tidal');

(async () => {
    try {
        const query = "Daft Punk - One More Time";
        console.log(`Testing search for: ${query}`);
        
        const url = await searchTrack(query);
        console.log(`Search result:`, url);

        if (url) {
            console.log("Tidal search successful (User Auth). Skipping actual download to save time/bandwidth, but smartDownload logic would try it.");
        } else {
            console.log("Tidal search returned no results. NOTE: You need to run `npm run auth-tidal` first if you haven't!");
        }

    } catch (e) {
        console.error("Test failed:", e);
    }
})();
