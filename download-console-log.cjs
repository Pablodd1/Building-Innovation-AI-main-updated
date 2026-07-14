// download-console-log.cjs — Downloads the remote console.log from Hostinger
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

    const remoteLogPath = '/nodejs/console.log';
    console.log(`Checking for remote log: ${remoteLogPath}`);
    
    try {
        const localLogPath = path.join(__dirname, 'remote_console.log');
        await c.downloadTo(localLogPath, remoteLogPath);
        console.log(`Successfully downloaded remote log to ${localLogPath}`);
        
        // Print the last 100 lines of the log
        const logContent = fs.readFileSync(localLogPath, 'utf8');
        const lines = logContent.split('\n');
        console.log('\n--- LAST 100 LINES OF REMOTE CONSOLE.LOG ---');
        console.log(lines.slice(-100).join('\n'));
    } catch (e) {
        console.log('Error downloading logs:', e.message);
    }

    c.close();
}

main().catch(console.error);
