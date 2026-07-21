// One-off: list files in the Hostinger app root + candidate config locations.
const { Client } = require('basic-ftp');

const FTP_CONFIG = {
    host: '157.173.208.16',
    user: 'u496083892.buildingapp.us',
    password: process.env.FTP_PASSWORD,
    secure: true,
    secureOptions: { rejectUnauthorized: false }
};

async function list(c, dir) {
    try {
        const items = await c.list(dir);
        console.log(`\n=== ${dir} ===`);
        for (const it of items) {
            console.log(`  ${it.isFile ? 'F' : 'D'} ${it.size.toString().padStart(10)}  ${it.name}`);
        }
    } catch (e) {
        console.log(`\n=== ${dir} ===  NOT ACCESSIBLE: ${e.message}`);
    }
}

(async () => {
    if (!FTP_CONFIG.password) { console.error('FTP_PASSWORD env var required'); process.exit(1); }
    const c = new Client();
    c.ftp.verbose = false;
    try {
        await c.access(FTP_CONFIG);
        console.log('Connected. Looking for config.json...');

        // Search candidate locations
        for (const dir of [
            '/',
            '/nodejs',
            '/nodejs/data',
            '/nodejs/dist-server',
            '/domains',
            '/domains/buildingapp.us',
            '/domains/buildingapp.us/public_html',
            '/home/u496083892',
        ]) {
            await list(c, dir);
        }

        // Try a recursive-ish search for config.json by listing deeper
        console.log('\n=== Searching for config.json by name ===');
        for (const candidate of [
            '/nodejs/data/config.json',
            '/nodejs/config.json',
            '/nodejs/dist-server/config.json',
            '/domains/buildingapp.us/public_html/data/config.json',
            '/domains/buildingapp.us/public_html/nodejs/data/config.json',
            '/domains/buildingapp.us/public_html/config.json',
        ]) {
            try {
                const sz = await c.size(candidate);
                console.log(`  FOUND: ${candidate}  (${sz} bytes)`);
            } catch {
                console.log(`  no:    ${candidate}`);
            }
        }

        // Also check for .env files since keys might be there
        console.log('\n=== Searching for .env files ===');
        for (const candidate of [
            '/nodejs/.env',
            '/nodejs/dist-server/.env',
            '/domains/buildingapp.us/public_html/.env',
        ]) {
            try {
                const sz = await c.size(candidate);
                console.log(`  FOUND: ${candidate}  (${sz} bytes)`);
            } catch {
                console.log(`  no:    ${candidate}`);
            }
        }
    } catch (e) {
        console.error('Failed:', e.message);
        process.exit(1);
    } finally {
        c.close();
    }
})();
