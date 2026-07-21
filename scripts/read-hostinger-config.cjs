// One-off: read data/config.json from Hostinger to a TEMP file (not the repo),
// show the AI_PROVIDER field + masked keys, then delete the temp file.
// Never writes anything to disk on the server.
const { Client } = require('basic-ftp');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FTP_CONFIG = {
    host: '157.173.208.16',
    user: 'u496083892.buildingapp.us',
    password: process.env.FTP_PASSWORD,
    secure: true,
    secureOptions: { rejectUnauthorized: false }
};

const REMOTE = '/nodejs/data/config.json';

function mask(k) {
    if (!k) return '(missing)';
    if (k.length <= 9) return k.slice(0, 3) + '...';
    return `${k.slice(0, 5)}...${k.slice(-4)} (len ${k.length})`;
}

(async () => {
    if (!FTP_CONFIG.password) {
        console.error('FTP_PASSWORD env var required');
        process.exit(1);
    }
    const c = new Client();
    c.ftp.verbose = false;
    const tmp = path.join(os.tmpdir(), `cfg_${Date.now()}.json`);
    try {
        console.log('Connecting to Hostinger FTP...');
        await c.access(FTP_CONFIG);
        console.log(`Reading ${REMOTE} ...`);
        await c.downloadTo(tmp, REMOTE);
        const raw = fs.readFileSync(tmp, 'utf8');
        let cfg;
        try { cfg = JSON.parse(raw); }
        catch (e) {
            console.error('config.json is not valid JSON:', e.message);
            console.error('First 200 chars:', raw.slice(0, 200));
            process.exit(1);
        }
        console.log('\n=== CURRENT data/config.json (keys masked) ===');
        console.log('  AI_PROVIDER:    ', JSON.stringify(cfg.AI_PROVIDER) || '(not set — defaults to gemini)');
        console.log('  GEMINI_API_KEY: ', mask(cfg.GEMINI_API_KEY));
        console.log('  OPENAI_API_KEY: ', mask(cfg.OPENAI_API_KEY));
        console.log('  OPENROUTER_API_KEY:', mask(cfg.OPENROUTER_API_KEY));
        console.log('  (other fields): ', Object.keys(cfg).filter(k => !['AI_PROVIDER','GEMINI_API_KEY','OPENAI_API_KEY','OPENROUTER_API_KEY'].includes(k)).join(', ') || '(none)');
        console.log('\nNo changes made. File on server is untouched.');
    } catch (e) {
        console.error('Failed:', e.message);
        process.exit(1);
    } finally {
        c.close();
        try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
    }
})();
