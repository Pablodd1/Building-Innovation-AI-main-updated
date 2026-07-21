// list-all-remote-files.cjs — Lists files in root and public directories to find .htaccess or config files
const { Client } = require('basic-ftp');

const FTP_CONFIG = {
    host: '157.173.208.16',
    user: 'u496083892.buildingapp.us',
    password: process.env.FTP_PASSWORD || 's~NT@9qK$W0jVE]4',
    secure: true,
    secureOptions: { rejectUnauthorized: false }
};

async function main() {
    const c = new Client();
    await c.access(FTP_CONFIG);
    console.log('Connected.');

    const directories = ['/nodejs/dist-server/logs'];
    for (const dir of directories) {
        try {
            console.log(`\n--- LISTING: ${dir} ---`);
            const list = await c.list(dir);
            list.forEach(f => {
                console.log(`  ${f.isDirectory ? 'd' : 'f'} ${f.name} (${f.size}b)`);
            });
        } catch (e) {
            console.log(`  Error listing ${dir}:`, e.message);
        }
    }

    c.close();
}

main().catch(console.error);
