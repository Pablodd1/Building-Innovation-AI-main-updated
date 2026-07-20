// download-data-files.cjs — Downloads persistent JSON logs from remote server
const { Client } = require('basic-ftp');
const fs = require('fs');
const path = require('path');

const FTP_CONFIG = {
    host: '157.173.208.16',
    user: 'u496083892.buildingapp.us',
    password: process.env.FTP_PASSWORD || 's~NT@9qK$W0jVE]4',
    secure: true,
    secureOptions: { rejectUnauthorized: false }
};

async function main() {
    const c = new Client();
    await c.access(FTP_CONFIG);
    console.log('Connected to Hostinger FTP.');

    const files = [
        'generation_log.persistent.json',
        'user_activity.persistent.json',
        'audit_logs.persistent.json'
    ];

    for (const file of files) {
        const remotePath = `/nodejs/data/${file}`;
        const localPath = path.join(__dirname, file);
        try {
            console.log(`Downloading: ${remotePath} -> ${localPath}`);
            await c.downloadTo(localPath, remotePath);
            console.log(`Successfully downloaded ${file}`);
        } catch (e) {
            console.log(`Error downloading ${file}:`, e.message);
        }
    }

    c.close();
}

main().catch(console.error);
