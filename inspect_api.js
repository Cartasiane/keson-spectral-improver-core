try {
    const { createAPIClient } = require('@tidal-music/api');
    
    const mockAuth = {
        getCredentials: async () => ({ token: 'mock' })
    };
    
    try {
        const client = createAPIClient(mockAuth);
        console.log('Client keys:', Object.keys(client));
        if (client.search) console.log('Client.search keys:', Object.keys(client.search));
    } catch (e) {
        console.log('Error instantiating:', e.message);
    }
} catch (e) {
    console.error(e);
}
