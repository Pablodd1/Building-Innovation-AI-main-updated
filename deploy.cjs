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

async function uploadDir(client, localDir, remoteDir) {
    console.log(`Uploading ${localDir} -> ${remoteDir}`);
    await client.ensureDir(remoteDir);
    const items = fs.readdirSync(localDir);
    for (const item of items) {
        const localPath = path.join(localDir, item);
        const remotePath = path.posix.join(remoteDir, item);
        const stat = fs.statSync(localPath);
        if (stat.isDirectory()) {
            await uploadDir(client, localPath, remotePath);
        } else {
            console.log(`  Uploading ${item}...`);
            await client.uploadFrom(localPath, remotePath);
        }
    }
}

async function deploy() {
    const client = new Client();
    client.ftp.verbose = true;
    try {
        console.log('Connecting to Hostinger FTP...');
        await client.access(FTP_CONFIG);
        console.log('Connected!');
        
        await client.ensureDir('/public_html');
        
        // Upload dist/
        if (fs.existsSync('./dist')) {
            await uploadDir(client, './dist', '/public_html/dist');
        }
        
        // Upload dist-server/
        if (fs.existsSync('./dist-server')) {
            await uploadDir(client, './dist-server', '/public_html/dist-server');
        }
        
        console.log('Upload complete!');
        
        // Trigger restart
        console.log('Triggering restart...');
        await fetch('https://buildingapp.us/deploy-php.php?run=1').catch(() => {});
        console.log('Done!');
    } catch (err) {
        console.error('Deploy failed:', err.message);
        process.exit(1);
    } finally {
        client.close();
    }
}

deploy();
