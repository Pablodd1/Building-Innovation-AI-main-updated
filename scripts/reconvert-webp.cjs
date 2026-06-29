const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'product-images');
const OUT_DIR = path.join(__dirname, '..', 'products');
const OUT_WEBP_DIR = path.join(__dirname, '..', 'product-webp');

async function convert() {
    const pngFiles = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.png'));
    console.log(`Found ${pngFiles.length} PNG files to convert`);

    let totalOld = 0;
    let totalNew = 0;
    let improved = 0;
    const results = [];

    for (let i = 0; i < pngFiles.length; i++) {
        const pngName = pngFiles[i];
        const base = path.basename(pngName, '.png');
        const srcPath = path.join(SRC_DIR, pngName);
        const outPath = path.join(OUT_DIR, `${base}.webp`);
        const outWebpPath = path.join(OUT_WEBP_DIR, `${base}.webp`);

        const pngSize = fs.statSync(srcPath).size;
        let oldWebpSize = 0;
        if (fs.existsSync(outPath)) oldWebpSize = fs.statSync(outPath).size;

        try {
            await sharp(srcPath)
                .webp({ quality: 88, effort: 6 })
                .toFile(outPath);

            // Also update product-webp/ if it exists there
            if (fs.existsSync(OUT_WEBP_DIR)) {
                await sharp(srcPath)
                    .webp({ quality: 88, effort: 6 })
                    .toFile(outWebpPath);
            }

            const newWebpSize = fs.statSync(outPath).size;
            totalOld += oldWebpSize;
            totalNew += newWebpSize;
            if (newWebpSize > oldWebpSize) improved++;

            const ratio = Math.round((newWebpSize / pngSize) * 100);
            results.push({ base, pngSize, oldWebpSize, newWebpSize, ratio });

            if ((i + 1) % 50 === 0) {
                console.log(`  ... ${i + 1}/${pngFiles.length} done`);
            }
        } catch (err) {
            console.error(`FAILED ${base}: ${err.message}`);
        }
    }

    // Sort by worst new ratio
    results.sort((a, b) => a.ratio - b.ratio);

    console.log('\n=== TOP 20 WORST STILL (after reconvert) ===');
    results.slice(0, 20).forEach(r => {
        console.log(`${r.base}: png=${r.pngSize} oldWebp=${r.oldWebpSize} newWebp=${r.newWebpSize} ratio=${r.ratio}%`);
    });

    console.log('\n=== 14121222 SPECIFIC ===');
    const r1412 = results.find(r => r.base === '14121222');
    if (r1412) console.log(JSON.stringify(r1412, null, 2));

    console.log(`\n=== SUMMARY ===`);
    console.log(`Total old WebP bytes: ${totalOld.toLocaleString()}`);
    console.log(`Total new WebP bytes: ${totalNew.toLocaleString()}`);
    console.log(`Improved count: ${improved}/${pngFiles.length}`);
}

convert().catch(console.error);
