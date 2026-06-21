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

const REMOTE = '/nodejs';

async function main() {
    const c = new Client();
    c.ftp.verbose = false;
    await c.access(FTP_CONFIG);
    
    // Clean stale assets
    const localAssets = new Set(fs.readdirSync('./dist/assets'));
    const remoteAssets = await c.list(REMOTE + '/dist/assets');
    for (const f of remoteAssets.filter(x => x.isFile)) {
        if (!localAssets.has(f.name)) {
            console.log('Removing stale:', f.name);
            await c.remove(REMOTE + '/dist/assets/' + f.name);
        }
    }
    
    // Re-upload server bundle
    console.log('\nServer bundle...');
    await c.uploadFrom('./dist-server/app.cjs', REMOTE + '/dist-server/app.cjs');
    
    // Re-upload frontend
    console.log('Frontend dist...');
    const items = fs.readdirSync('./dist');
    for (const item of items) {
        const loc = path.join('./dist', item);
        const rem = path.posix.join(REMOTE, '/dist', item);
        if (fs.statSync(loc).isDirectory()) {
            await c.ensureDir(rem);
            for (const f2 of fs.readdirSync(loc)) {
                await c.uploadFrom(path.join(loc, f2), path.posix.join(rem, f2));
            }
        } else {
            await c.uploadFrom(loc, rem);
        }
    }
    
    // Restart
    await c.ensureDir(REMOTE + '/tmp');
    fs.writeFileSync('/tmp/restart.txt', new Date().toISOString() + '\n');
    await c.uploadFrom('/tmp/restart.txt', REMOTE + '/tmp/restart.txt');
    
    // Verify
    const ds = await c.list(REMOTE + '/dist-server');
    const app = ds.find(f => f.name === 'app.cjs');
    console.log('\nServer app.cjs:', app ? app.size + 'b' : 'MISSING');
    
    const assets = await c.list(REMOTE + '/dist/assets');
    console.log('Assets:', assets.filter(f => f.isFile).map(f => f.name));
    
    c.close();
    console.log('\nDone.');
}
main().catch(e => { console.error(e.message); process.exit(1); });
