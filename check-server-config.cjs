// check-server-config.cjs — reads data/ directory and config.json from Hostinger
const { Client } = require('basic-ftp');
const fs = require('fs');
const os = require('os');
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
    c.ftp.verbose = false;
    await c.access(FTP_CONFIG);

    // List /nodejs/data
    console.log('\n--- /nodejs/data/ ---');
    try {
        const list = await c.list('/nodejs/data');
        list.forEach(f => console.log(`  ${f.isDirectory ? 'd' : 'f'} ${f.name} (${f.size}b)`));
    } catch(e) { console.log('  Error:', e.message); }

    // Download config.json if it exists
    console.log('\n--- /nodejs/data/config.json ---');
    try {
        const tmpPath = path.join(os.tmpdir(), 'server_config.json');
        await c.downloadTo(tmpPath, '/nodejs/data/config.json');
        const content = fs.readFileSync(tmpPath, 'utf8');
        const parsed = JSON.parse(content);
        // Mask sensitive values
        const masked = {};
        for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === 'string' && v.length > 8) {
                masked[k] = v.substring(0, 6) + '...' + v.slice(-4);
            } else {
                masked[k] = v;
            }
        }
        console.log(JSON.stringify(masked, null, 2));
        fs.unlinkSync(tmpPath);
    } catch(e) { console.log('  Not found or error:', e.message); }

    // Check /nodejs/.env
    console.log('\n--- /nodejs/.env (keys only) ---');
    try {
        const tmpPath2 = path.join(os.tmpdir(), 'server_env.txt');
        await c.downloadTo(tmpPath2, '/nodejs/.env');
        const lines = fs.readFileSync(tmpPath2, 'utf8').split('\n');
        lines.forEach(l => {
            const trimmed = l.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                const key = trimmed.split('=')[0];
                console.log('  ' + key + '=<set>');
            }
        });
        fs.unlinkSync(tmpPath2);
    } catch(e) { console.log('  Not found:', e.message); }

    c.close();
}
main().catch(e => { console.error('Error:', e.message); process.exit(1); });
