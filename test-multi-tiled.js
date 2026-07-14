import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

async function testMultiTiled() {
    const PHOTO_PATH = 'C:\\Users\\jasme\\Downloads\\sample_room.jpg';
    const PRODUCT_URL = 'https://buildingapp.us/products/14031001.webp';
    
    console.log("Fetching product image...");
    const res = await fetch(PRODUCT_URL);
    const productBuffer = Buffer.from(await res.arrayBuffer());
    const photoBuffer = fs.readFileSync(PHOTO_PATH);

    const W = 1200;
    const H = 800;

    const photoResized = await sharp(photoBuffer).resize(W, H).toBuffer();

    // Two walls from the AI analysis
    const surfaces = [
        {
            type: "wall",
            bounds: { x: 0, y: 0, width: 0.45, height: 0.68 }
        },
        {
            type: "wall",
            bounds: { x: 0.45, y: 0, width: 0.55, height: 0.68 }
        }
    ];

    // Detect brightness to choose blend mode
    const { channels } = await sharp(productBuffer).stats();
    const brightness = (channels[0].mean + channels[1].mean + channels[2].mean) / 3;
    const blendMode = brightness > 200 ? "overlay" : "multiply";
    console.log(`Product brightness: ${brightness.toFixed(1)}, using blendMode: ${blendMode}`);

    const productMeta = await sharp(productBuffer).metadata();
    const aspect = (productMeta.width || 1) / (productMeta.height || 1);
    const tileWidth = 150;
    const tileHeight = Math.round(tileWidth / aspect);

    const resizedTile = await sharp(productBuffer)
        .resize(tileWidth, tileHeight)
        .toBuffer();

    const compositeOps = [];

    for (const s of surfaces) {
        const bounds = {
            x: Math.round(s.bounds.x * W),
            y: Math.round(s.bounds.y * H),
            width: Math.round(s.bounds.width * W),
            height: Math.round(s.bounds.height * H)
        };

        const tiledBuffer = await sharp({
            create: {
                width: bounds.width,
                height: bounds.height,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            }
        })
        .composite([{
            input: resizedTile,
            tile: true
        }])
        .png()
        .toBuffer();

        compositeOps.push({
            input: tiledBuffer,
            left: bounds.x,
            top: bounds.y,
            blend: blendMode
        });
    }

    const output = await sharp(photoResized)
        .composite(compositeOps)
        .toBuffer();

    const outDir = 'C:\\Users\\jasme\\.gemini\\antigravity\\brain\\4844b23b-e0d6-407a-94fd-af0f60a0c0c8\\scratch';
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'output_multi_tiled.png'), output);
    console.log("Saved multi-tiled output!");
}

testMultiTiled().catch(console.error);
