const { Client } = require('basic-ftp');
const fs = require('fs');
const path = require('path');

// ============================================================================
// FULL DEPLOY: server bundle + frontend + data/users.persistent.json
// Uploads DIRECTLY into the live Passenger app dir (/nodejs)
// ============================================================================

const FTP_CONFIG = {
    host: '157.173.208.16',
    user: 'u496083892.buildingapp.us',
    password: process.env.FTP_PASSWORD || '',
    secure: true,
    secureOptions: { rejectUnauthorized: false }
};

const REMOTE_APP_ROOT = '/nodejs';

async function uploadFile(client, localPath, remotePath) {
    console.log(`  Uploading ${path.basename(localPath)} -> ${remotePath}`);
    await client.uploadFrom(localPath, remotePath);
}

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
            await uploadFile(client, localPath, remotePath);
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
        // Verify server bundle
        const ds = await client.list(`${REMOTE_APP_ROOT}/dist-server`);
        const app = ds.find(f => f.name === 'app.cjs');
        const localSize = fs.statSync('./dist-server/app.cjs').size;
        console.log(`Verify server: remote=${app ? app.size : 'MISSING'}b, local=${localSize}b`,
            app && app.size === localSize ? '✅ MATCH' : '⚠️ MISMATCH');
        
        // Verify users data
        const dd = await client.list(`${REMOTE_APP_ROOT}/data`);
        const usersFile = dd.find(f => f.name === 'users.persistent.json');
        const localUsersSize = fs.statSync('./data/users.persistent.json').size;
        console.log(`Verify users: remote=${usersFile ? usersFile.size : 'MISSING'}b, local=${localUsersSize}b`,
            usersFile && usersFile.size === localUsersSize ? '✅ MATCH' : '⚠️ MISMATCH');
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
        
        // 1. Upload server bundle
        console.log('\n--- Server Bundle ---');
        await uploadDir(client, './dist-server', `${REMOTE_APP_ROOT}/dist-server`);
        
        // 2. Upload frontend
        console.log('\n--- Frontend ---');
        await uploadDir(client, './dist', `${REMOTE_APP_ROOT}/dist`);
        
        // 3. Upload users data (CRITICAL - contains all user accounts)
        console.log('\n--- User Data ---');
        await client.ensureDir(`${REMOTE_APP_ROOT}/data`);
        await uploadFile(client, './data/users.persistent.json', `${REMOTE_APP_ROOT}/data/users.persistent.json`);
        
        // 4. Restart
        console.log('');
        await restartPassenger(client);
        await verify(client);
        console.log('\n✅ Full deploy complete!');
    } catch (err) {
        console.error('Deploy FAILED:', err.message);
        process.exit(1);
    } finally {
        client.close();
    }
}

deploy();
