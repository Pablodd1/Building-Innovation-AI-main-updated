// upload-server-config.cjs — Creates data/config.json on Hostinger with API keys
// This ensures keys survive server restarts and don't depend on .env being present
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

// Read keys from local .env
function readEnv() {
    const envPath = path.join(__dirname, '.env');
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    const env = {};
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const idx = trimmed.indexOf('=');
            if (idx !== -1) {
                env[trimmed.substring(0, idx).trim()] = trimmed.substring(idx + 1).trim();
            }
        }
    }
    return env;
}

async function main() {
    const env = readEnv();

    // Build config.json for the server
    const config = {
        AI_PROVIDER: 'gemini',
        GEMINI_API_KEY: env.GEMINI_API_KEY || '',
        OPENAI_API_KEY: env.OPENAI_API_KEY || '',
        OPENROUTER_API_KEY: env.OPENROUTER_API_KEY || '',
        STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY || '',
        STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET || '',
    };

    console.log('Config to upload:');
    for (const [k, v] of Object.entries(config)) {
        if (v) console.log(`  ${k} = ${v.substring(0, 8)}...`);
        else console.log(`  ${k} = (empty)`);
    }

    // Write to temp file
    const tmpPath = path.join(os.tmpdir(), 'server_config.json');
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf8');

    // Upload via FTP
    const c = new Client();
    c.ftp.verbose = false;
    await c.access(FTP_CONFIG);

    console.log('\nUploading data/config.json to Hostinger...');
    await c.ensureDir('/nodejs/data');
    await c.uploadFrom(tmpPath, '/nodejs/data/config.json');
    console.log('✅ config.json uploaded');

    // Verify
    const list = await c.list('/nodejs/data');
    const cfg = list.find(f => f.name === 'config.json');
    console.log(`✅ Verified on server: config.json (${cfg?.size} bytes)`);

    // Trigger restart
    const restartTmp = path.join(os.tmpdir(), 'restart.txt');
    fs.writeFileSync(restartTmp, new Date().toISOString() + '\n');
    await c.ensureDir('/nodejs/tmp');
    await c.uploadFrom(restartTmp, '/nodejs/tmp/restart.txt');
    console.log('✅ Server restart triggered');

    c.close();
    fs.unlinkSync(tmpPath);
    fs.unlinkSync(restartTmp);

    console.log('\nDone! Server will use config.json for API keys on next request.');
}
main().catch(e => { console.error('Error:', e.message); process.exit(1); });
