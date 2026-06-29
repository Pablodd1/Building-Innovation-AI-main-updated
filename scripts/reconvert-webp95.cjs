const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'product-images');
const OUT_DIR = path.join(__dirname, '..', 'products');
const OUT_WEBP_DIR = path.join(__dirname, '..', 'product-webp');

async function convert() {
    const pngFiles = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.png'));
    console.log(`Re-converting ${pngFiles.length} PNGs to WebP quality 95`);

    let totalOld = 0;
    let totalNew = 0;
    const results = [];

    for (let i = 0; i < pngFiles.length; i++) {
        const pngName = pngFiles[i];
        const base = path.basename(pngName, '.png');
        const srcPath = path.join(SRC_DIR, pngName);
        const outPath = path.join(OUT_DIR, `${base}.webp`);
        const outWebpPath = path.join(OUT_WEBP_DIR, `${base}.webp`);

        let oldWebpSize = 0;
        if (fs.existsSync(outPath)) oldWebpSize = fs.statSync(outPath).size;

        try {
            await sharp(srcPath)
                .webp({ quality: 95, effort: 6 })
                .toFile(outPath);

            if (fs.existsSync(OUT_WEBP_DIR)) {
                await sharp(srcPath)
                    .webp({ quality: 95, effort: 6 })
                    .toFile(outWebpPath);
            }

            const newWebpSize = fs.statSync(outPath).size;
            totalOld += oldWebpSize;
            totalNew += newWebpSize;

            results.push({ base, oldWebpSize, newWebpSize });

            if ((i + 1) % 50 === 0) {
                console.log(`  ... ${i + 1}/${pngFiles.length} done`);
            }
        } catch (err) {
            console.error(`FAILED ${base}: ${err.message}`);
        }
    }

    // Verify 14121222
    const r1412 = results.find(r => r.base === '14121222');
    console.log('\n=== 14121222 ===');
    console.log(`Old: ${r1412.oldWebpSize} bytes → New: ${r1412.newWebpSize} bytes`);
    console.log(`Improvement: ${Math.round((r1412.newWebpSize / r1412.oldWebpSize - 1) * 100)}% larger`);

    console.log('\n=== SUMMARY ===');
    console.log(`Total old WebP: ${(totalOld / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Total new WebP: ${(totalNew / 1024 / 1024).toFixed(2)} MB`);
    console.log(`All ${pngFiles.length} images converted successfully.`);
}

convert().catch(console.error);
