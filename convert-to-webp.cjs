const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const sourceDir = 'product-images';
const targetDir = 'products';
const quality = 95; // Maximum quality for AI reference images

async function convertAll() {
    if (!fs.existsSync(sourceDir)) {
        console.error(`Source dir ${sourceDir} not found`);
        process.exit(1);
    }
    
    const pngs = fs.readdirSync(sourceDir).filter(f => f.endsWith('.png'));
    console.log(`Found ${pngs.length} PNGs to convert at quality ${quality}`);
    
    let ok = 0, errors = 0;
    let totalDstKB = 0;
    
    for (const png of pngs) {
        const webpName = png.replace('.png', '.webp');
        const srcPath = path.join(sourceDir, png);
        const dstPath = path.join(targetDir, webpName);
        
        try {
            const srcSize = fs.statSync(srcPath).size;
            await sharp(srcPath)
                .webp({ quality })
                .toFile(dstPath);
            const dstSize = fs.statSync(dstPath).size;
            totalDstKB += dstSize / 1024;
            ok++;
            console.log(`OK  ${webpName}: ${(srcSize/1024).toFixed(0)}KB PNG → ${(dstSize/1024).toFixed(0)}KB WebP (${(dstSize/srcSize*100).toFixed(0)}%)`);
        } catch (err) {
            errors++;
            console.error(`ERR ${webpName}: ${err.message}`);
        }
    }
    
    console.log(`\n=== DONE ===`);
    console.log(`Converted: ${ok} | Errors: ${errors} | Total output: ${(totalDstKB/1024).toFixed(1)} MB`);
}

convertAll().catch(err => { console.error(err); process.exit(1); });
