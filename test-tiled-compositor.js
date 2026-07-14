import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

async function testTiledCompositor() {
    const PHOTO_PATH = 'C:\\Users\\jasme\\Downloads\\sample_room.jpg';
    const PRODUCT_URL = 'https://buildingapp.us/products/14031001.webp';
    
    console.log("Fetching product image...");
    const res = await fetch(PRODUCT_URL);
    const productBuffer = Buffer.from(await res.arrayBuffer());
    const photoBuffer = fs.readFileSync(PHOTO_PATH);

    const W = 1200;
    const H = 800;

    // Resized photo to standard dimensions
    const photoResized = await sharp(photoBuffer).resize(W, H).toBuffer();

    // Bounds of the wall from the AI analysis
    const bounds = {
        x: Math.round(0.45 * W),
        y: Math.round(0.0 * H),
        width: Math.round(0.55 * W),
        height: Math.round(0.68 * H)
    };

    console.log("Target Bounds:", bounds);

    // 1. Resize product image to a realistic tile size (e.g. 150px width, preserve aspect ratio)
    const productMeta = await sharp(productBuffer).metadata();
    const aspect = (productMeta.width || 1) / (productMeta.height || 1);
    const tileWidth = 150;
    const tileHeight = Math.round(tileWidth / aspect);

    const resizedTile = await sharp(productBuffer)
        .resize(tileWidth, tileHeight)
        .toBuffer();

    // 2. Tile the product image to cover the bounds
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

    // 3. Composite onto original image using "multiply" and "over" to compare
    const outputOver = await sharp(photoResized)
        .composite([{
            input: tiledBuffer,
            left: bounds.x,
            top: bounds.y,
            blend: "over"
        }])
        .toBuffer();

    const outputMultiply = await sharp(photoResized)
        .composite([{
            input: tiledBuffer,
            left: bounds.x,
            top: bounds.y,
            blend: "multiply"
        }])
        .toBuffer();

    const outputOverlay = await sharp(photoResized)
        .composite([{
            input: tiledBuffer,
            left: bounds.x,
            top: bounds.y,
            blend: "overlay"
        }])
        .toBuffer();

    const outDir = 'C:\\Users\\jasme\\.gemini\\antigravity\\brain\\4844b23b-e0d6-407a-94fd-af0f60a0c0c8\\scratch';
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'output_over.png'), outputOver);
    fs.writeFileSync(path.join(outDir, 'output_multiply.png'), outputMultiply);
    fs.writeFileSync(path.join(outDir, 'output_overlay.png'), outputOverlay);
    console.log("Saved test outputs!");
}

testTiledCompositor().catch(console.error);
