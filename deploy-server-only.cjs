// deploy-server-only.cjs — Uploads ONLY the server bundle and triggers restart
const { Client } = require('basic-ftp');
const fs = require('fs');

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

    console.log('Connecting to Hostinger FTP...');
    await c.access(FTP_CONFIG);
    console.log('Connected!\n');

    // Upload server bundle
    console.log('Uploading dist-server/app.cjs...');
    await c.ensureDir(REMOTE + '/dist-server');
    await c.uploadFrom('./dist-server/app.cjs', REMOTE + '/dist-server/app.cjs');
    console.log('✅ Server bundle uploaded');

    // Trigger restart by touching tmp/restart.txt
    console.log('\nTriggering server restart...');
    await c.ensureDir(REMOTE + '/tmp');
    const tmpPath = require('os').tmpdir() + '/restart_' + Date.now() + '.txt';
    fs.writeFileSync(tmpPath, new Date().toISOString() + '\n');
    await c.uploadFrom(tmpPath, REMOTE + '/tmp/restart.txt');
    fs.unlinkSync(tmpPath);
    console.log('✅ Restart triggered');

    // Verify uploaded size
    const ds = await c.list(REMOTE + '/dist-server');
    const app = ds.find(f => f.name === 'app.cjs');
    console.log('\nVerification:');
    console.log('  app.cjs size on server:', app ? Math.round(app.size / 1024) + ' KB' : 'MISSING ❌');

    c.close();
    console.log('\nDone ✅');
}

main().catch(e => { console.error('❌ Deploy failed:', e.message); process.exit(1); });
