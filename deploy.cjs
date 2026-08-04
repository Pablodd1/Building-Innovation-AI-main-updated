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
    // Use the direct IP — DNS resolution of ftp.buildingapp.us can time out or
    // resolve to a different edge on GitHub Actions runners in some regions.
    host: 'ftp.buildingapp.us',
    user: 'u496083892.nodejs',
    password: process.env.FTP_PASSWORD || '',
    secure: true,
    secureOptions: { rejectUnauthorized: false },
    // GitHub runners have aggressive control-socket idle timeouts. The default
    // 10s is too short for large uploads over passive FTP — bump to 60s.
    timeout: 60000
};

// Live Passenger app root on the server.
// The FTP account u496083892.nodejs is chrooted into the /nodejs directory,
// so its root "/" IS the app root — no /nodejs prefix needed.
const REMOTE_APP_ROOT = '';

async function uploadDir(client, localDir, remoteDir) {
    console.log(`Uploading ${localDir} -> ${remoteDir}`);
    // Ensure remote dir exists — swallow errors (dir may already exist)
    try { await client.ensureDir(remoteDir); } catch (e) {
        console.warn(`  ⚠️  ensureDir failed for ${remoteDir}: ${e.message} — skipping subtree`);
        return;
    }
    const items = fs.readdirSync(localDir);
    for (const item of items) {
        const localPath = path.join(localDir, item);
        const remotePath = path.posix.join(remoteDir, item);
        const stat = fs.statSync(localPath);
        if (stat.isDirectory()) {
            await uploadDir(client, localPath, remotePath);
        } else {
            try {
                console.log(`  Uploading ${item}...`);
                await client.uploadFrom(localPath, remotePath);
            } catch (e) {
                console.warn(`  ⚠️  Failed to upload ${item}: ${e.message} — continuing`);
            }
        }
    }
}

async function restartPassenger(client) {
    // Passenger watches for restart.txt at the APP ROOT, not /tmp/.
    // The chrooted FTP account root "/" IS the app root (previously /nodejs/),
    // so we upload restart.txt directly to "/" — NOT to /tmp/.
    console.log('Restarting Passenger (touch /restart.txt at app root)...');
    const stamp = `${new Date().toISOString()} deploy\n`;
    const tmpLocal = path.join(require('os').tmpdir(), 'restart.txt');
    fs.writeFileSync(tmpLocal, stamp);
    await client.uploadFrom(tmpLocal, `${REMOTE_APP_ROOT}/restart.txt`);
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
    if (!FTP_CONFIG.password) {
        console.error('Deploy FAILED: FTP_PASSWORD env var not set and no fallback configured.');
        process.exit(1);
    }
    const client = new Client();
    // Verbose output in CI (GITHUB_ACTIONS=true) for debugging FTP issues.
    client.ftp.verbose = process.env.GITHUB_ACTIONS === 'true';
    try {
        console.log('Connecting to Hostinger FTP (host=' + FTP_CONFIG.host + ', timeout=' + FTP_CONFIG.timeout + 'ms)...');
        await client.access(FTP_CONFIG);
        console.log('Connected!');

        // Upload server bundle (the running app)
        if (fs.existsSync('./dist-server')) {
            await uploadDir(client, './dist-server', `${REMOTE_APP_ROOT}/dist-server`);
        } else {
            throw new Error('dist-server/ not found — run `npm run build` first');
        }

        // Upload frontend (served by Express from the app root /dist)
        if (fs.existsSync('./dist')) {
            await uploadDir(client, './dist', `${REMOTE_APP_ROOT}/dist`);
        }

        await restartPassenger(client);
        await verify(client);
        console.log('Done! Deploy landed in app root and Passenger restarted.');
    } catch (err) {
        console.error('Deploy FAILED:', err.message);
        process.exit(1);
    } finally {
        client.close();
    }
}

deploy();
