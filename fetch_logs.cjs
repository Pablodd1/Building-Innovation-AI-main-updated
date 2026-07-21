const { Client } = require('basic-ftp');
const fs = require('fs');

async function fetchLogs() {
    const client = new Client();
    client.ftp.verbose = false;

    try {
        await client.access({
            host: '157.173.208.16',
            user: 'u496083892.buildingapp.us',
            password: process.env.FTP_PASSWORD || 's~NT@9qK$W0jVE]4',
            secure: true,
            secureOptions: { rejectUnauthorized: false }
        });
        
        console.log("Connected! Downloading logs...");
        await client.downloadTo("ai_live.log", "/nodejs/dist-server/logs/ai.log");
        console.log("Downloaded successfully.");
    } catch (e) {
        console.error(e);
    }
    client.close();
}

fetchLogs();
