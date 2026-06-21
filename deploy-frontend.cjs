const { Client } = require('basic-ftp');
const fs = require('fs');
const path = require('path');

// Frontend-only deploy to the live Passenger app dir (/nodejs/dist).
// Express serves the SPA static files from /nodejs/dist. Server bundle unchanged.

const FTP_CONFIG = {
    host: '157.173.208.16',
    user: 'u496083892.buildingapp.us',
    password: process.env.FTP_PASSWORD || 's~NT@9qK$W0jVE]4',
    secure: true,
    secureOptions: { rejectUnauthorized: false }
};

const REMOTE_APP_ROOT = '/nodejs';

async function uploadDir(client, localDir, remoteDir) {
    await client.ensureDir(remoteDir);
    const items = fs.readdirSync(localDir);
    for (const item of items) {
        const localPath = path.join(localDir, item);
        const remotePath = path.posix.join(remoteDir, item);
        const stat = fs.statSync(localPath);
        if (stat.isDirectory()) {
            await uploadDir(client, localPath, remotePath);
        } else {
            console.log(`  Uploading ${remotePath}...`);
            await client.uploadFrom(localPath, remotePath);
        }
    }
}

async function cleanStaleAssets(client, localAssetsDir, remoteAssetsDir) {
    // Remove old hashed JS/CSS chunks on the server that are NOT in the new build.
    const keep = new Set(fs.readdirSync(localAssetsDir));
    let remote;
    try {
        remote = await client.list(remoteAssetsDir);
    } catch {
        return;
    }
    for (const f of remote) {
        if (f.isFile && !keep.has(f.name)) {
            console.log(`  Removing stale ${remoteAssetsDir}/${f.name}`);
            try { await client.remove(path.posix.join(remoteAssetsDir, f.name)); } catch (e) { console.log('   (skip)', e.message); }
        }
    }
}

async function restartPassenger(client) {
    await client.ensureDir(`${REMOTE_APP_ROOT}/tmp`);
    const stamp = `${new Date().toISOString()} frontend-deploy\n`;
    const tmpLocal = path.join(require('os').tmpdir(), 'restart.txt');
    fs.writeFileSync(tmpLocal, stamp);
    await client.uploadFrom(tmpLocal, `${REMOTE_APP_ROOT}/tmp/restart.txt`);
    console.log('Passenger restart queued.');
}

async function deploy() {
    const client = new Client();
    client.ftp.verbose = false;
    try {
        console.log('Connecting to Hostinger FTP...');
        await client.access(FTP_CONFIG);
        console.log('Connected!');
        if (!fs.existsSync('./dist')) throw new Error('dist/ not found — run `npm run build:frontend`');

        await uploadDir(client, './dist', `${REMOTE_APP_ROOT}/dist`);
        await cleanStaleAssets(client, './dist/assets', `${REMOTE_APP_ROOT}/dist/assets`);
        await restartPassenger(client);
        console.log('Frontend deploy done.');
    } catch (err) {
        console.error('Deploy FAILED:', err.message);
        process.exit(1);
    } finally {
        client.close();
    }
}

deploy();
