// download-logs.cjs — Downloads the remote logs from Hostinger for debugging
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

    const remoteLogPath = '/nodejs/logs/ai.log';
    console.log(`Checking for remote log: ${remoteLogPath}`);
    
    try {
        const localLogPath = path.join(__dirname, 'remote_ai.log');
        await c.downloadTo(localLogPath, remoteLogPath);
        console.log(`Successfully downloaded remote log to ${localLogPath}`);
        
        // Print the last 50 lines of the log
        const logContent = fs.readFileSync(localLogPath, 'utf8');
        const lines = logContent.split('\n');
        console.log('\n--- LAST 50 LINES OF REMOTE LOG ---');
        console.log(lines.slice(-50).join('\n'));
    } catch (e) {
        console.log('Error downloading logs:', e.message);
    }

    // Also check for passenger/error log files in the root
    try {
        console.log('\n--- ROOT FILES ---');
        const files = await c.list('/nodejs');
        files.forEach(f => {
            if (f.name.includes('log') || f.name.includes('err')) {
                console.log(`  File: ${f.name} (${f.size} bytes)`);
            }
        });
    } catch (e) {
        console.log('Error listing root:', e.message);
    }

    c.close();
}

main().catch(console.error);
