const { Client } = require('basic-ftp');
const fs = require('fs');
const path = require('path');

// ============================================================================
// Hostinger deploy — uploads DIRECTLY into the live Passenger app dir (/nodejs)
// and restarts Passenger by touching /nodejs/tmp/restart.txt.
//
// WHY: the running Node app lives in /nodejs/ (Phusion Passenger). The old
// script uploaded to /public_html/ and relied on deploy-php.php to copy
// public_html -> nodejs and restart. That PHP endpoint is UNREACHABLE (the SPA
// catch-all returns "Asset not found"), so deploys silently never took effect.
// This version writes straight to /nodejs/ and restarts via FTP. No PHP needed.
// ============================================================================

const FTP_CONFIG = {
    host: '157.173.208.16',
    user: 'u496083892.buildingapp.us',
    password: process.env.FTP_PASSWORD || 's~NT@9qK$W0jVE]4',
    secure: true,
    secureOptions: { rejectUnauthorized: false }
};

// Live Passenger app root on the server
const REMOTE_APP_ROOT = '/nodejs';

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

async function restartPassenger(client) {
    console.log('Restarting Passenger (touch /nodejs/tmp/restart.txt)...');
    await client.ensureDir(`${REMOTE_APP_ROOT}/tmp`);
    const stamp = `${new Date().toISOString()} deploy\n`;
    const tmpLocal = path.join(require('os').tmpdir(), 'restart.txt');
    fs.writeFileSync(tmpLocal, stamp);
    await client.uploadFrom(tmpLocal, `${REMOTE_APP_ROOT}/tmp/restart.txt`);
    console.log('Passenger will restart on next request.');
}

async function verify(client) {
    try {
        const ds = await client.list(`${REMOTE_APP_ROOT}/dist-server`);
        const app = ds.find(f => f.name === 'app.cjs');
        const localSize = fs.existsSync('./dist-server/app.cjs')
            ? fs.statSync('./dist-server/app.cjs').size : 0;
        console.log(`Verify: remote app.cjs=${app ? app.size : 'MISSING'}b, local=${localSize}b`,
            app && app.size === localSize ? '✅ MATCH' : '⚠️ MISMATCH');
    } catch (e) {
        console.log('Verify failed:', e.message);
    }
}

async function deploy() {
    const client = new Client();
    client.ftp.verbose = false;
    try {
        console.log('Connecting to Hostinger FTP...');
        await client.access(FTP_CONFIG);
        console.log('Connected!');

        // Upload server bundle (the running app)
        if (fs.existsSync('./dist-server')) {
            await uploadDir(client, './dist-server', `${REMOTE_APP_ROOT}/dist-server`);
        } else {
            throw new Error('dist-server/ not found — run `npm run build` first');
        }

        // Upload frontend (served by Express from /nodejs/dist)
        if (fs.existsSync('./dist')) {
            await uploadDir(client, './dist', `${REMOTE_APP_ROOT}/dist`);
        }

        await restartPassenger(client);
        await verify(client);
        console.log('Done! Deploy landed in /nodejs and Passenger restarted.');
    } catch (err) {
        console.error('Deploy FAILED:', err.message);
        process.exit(1);
    } finally {
        client.close();
    }
}

deploy();
