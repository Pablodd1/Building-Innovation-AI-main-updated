// scratch/test-compositor-new.js — Test script for new cropping and shade mapping compositor logic
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const IMAGE_PATH = 'C:\\Users\\jasme\\Downloads\\sample_room.jpg';
const PRODUCT_PATH = 'C:\\Users\\jasme\\.gemini\\antigravity\\Building-Innovation-AI-main-updated\\products\\14031002.webp';
const OUTPUT_PATH = 'C:\\Users\\jasme\\.gemini\\antigravity\\brain\\4844b23b-e0d6-407a-94fd-af0f60a0c0c8\\local_overlay_result.png';

// Surfaces mock from the analyze-room API
const analysis = {
    surfaces: [
        {
            type: 'wall',
            bounds: { x: 0, y: 0, width: 0.444, height: 0.771 },
            confidence: 0.98
        },
        {
            type: 'wall',
            bounds: { x: 0.444, y: 0, width: 0.556, height: 0.771 },
            confidence: 0.97
        },
        {
            type: 'floor',
            bounds: { x: 0, y: 0.732, width: 1, height: 0.268 },
            confidence: 0.99
        },
        {
            type: 'ceiling',
            bounds: { x: 0, y: 0, width: 1, height: 0.17 },
            confidence: 0.99
        },
        {
            type: 'door',
            bounds: { x: 0, y: 0.198, width: 0.147, height: 0.528 },
            confidence: 0.95
        },
        {
            type: 'window',
            bounds: { x: 0.796, y: 0.259, width: 0.204, height: 0.72 },
            confidence: 0.98
        },
        {
            type: 'window',
            bounds: { x: 0.612, y: 0.384, width: 0.163, height: 0.536 },
            confidence: 0.96
        },
        {
            type: 'furniture',
            bounds: { x: 0.5, y: 0.47, width: 0.5, height: 0.53 },
            confidence: 0.97
        }
    ]
};

async function run() {
    console.log("Loading user photo...");
    const userPhoto = sharp(IMAGE_PATH);
    const userMeta = await userPhoto.metadata();
    const imgWidth = userMeta.width || 800;
    const imgHeight = userMeta.height || 600;

    console.log("Processing product image to extract clean tile texture...");
    // Read product image dimensions
    const productBuffer = fs.readFileSync(PRODUCT_PATH);
    const prodMeta = await sharp(productBuffer).metadata();
    const pW = prodMeta.width || 1080;
    const pH = prodMeta.height || 1350;

    // Crop center 20% width and 80% height of the board to get pure texture
    const cropW = Math.round(pW * 0.20);
    const cropH = Math.round(pH * 0.80);
    const cropX = Math.round((pW - cropW) / 2);
    const cropY = Math.round((pH - cropH) / 2);

    console.log(`Cropping product texture at x=${cropX} y=${cropY} w=${cropW} h=${cropH}`);
    const croppedTextureBuffer = await sharp(productBuffer)
        .extract({ left: cropX, top: cropY, width: cropW, height: cropH })
        .png()
        .toBuffer();

    // Setup compositing targets (walls)
    const wallSurfaces = analysis.surfaces.filter(s => s.type === 'wall');
    const compositeOperations = [];

    for (const surface of wallSurfaces) {
        const x = Math.round(surface.bounds.x * imgWidth);
        const y = Math.round(surface.bounds.y * imgHeight);
        const w = Math.round(surface.bounds.width * imgWidth);
        const h = Math.round(surface.bounds.height * imgHeight);

        console.log(`Processing wall target: x=${x} y=${y} w=${w} h=${h}`);

        const croppedWallZone = sharp(IMAGE_PATH).extract({ left: x, top: y, width: w, height: h });
        const { channels } = await croppedWallZone.stats();
        const avgLuma = (channels[0].mean + channels[1].mean + channels[2].mean) / 3;

        // 1. Build a clean vector mask from AI-detected obstacles
        let mask = Buffer.alloc(w * h, 255); // Initialize to solid white (draw texture everywhere)

        // Mask out non-wall obstacles (furniture, door, window)
        const obstacles = analysis.surfaces.filter(s => s.type !== 'wall' && s.bounds);
        for (const obs of obstacles) {
            const ox = Math.round(obs.bounds.x * imgWidth);
            const oy = Math.round(obs.bounds.y * imgHeight);
            const ow = Math.round(obs.bounds.width * imgWidth);
            const oh = Math.round(obs.bounds.height * imgHeight);

            // Compute intersection
            const left = Math.max(x, ox);
            const top = Math.max(y, oy);
            const right = Math.min(x + w, ox + ow);
            const bottom = Math.min(y + h, oy + oh);

            if (right > left && bottom > top) {
                for (let row = top; row < bottom; row++) {
                    const maskY = row - y;
                    const rowStart = maskY * w;
                    for (let col = left; col < right; col++) {
                        const maskX = col - x;
                        mask[rowStart + maskX] = 0; // Black out obstacle
                    }
                }
            }
        }

        // 2. Tile the cropped product texture over this wall zone
        // For wall panels, tile in vertical strips (e.g. 200px width, full height)
        const tileW = Math.round(w / 4); // Tile width is 1/4 of wall width
        const tileH = h;
        const resizedTile = await sharp(croppedTextureBuffer)
            .resize(tileW, tileH, { fit: "fill" })
            .png()
            .toBuffer();

        const tiledWall = await sharp({
            create: {
                width: w,
                height: h,
                channels: 4,
                background: { r: 255, g: 255, b: 255, alpha: 0 }
            }
        })
        .composite([{ input: resizedTile, tile: true, blend: 'over' }])
        .png()
        .toBuffer();

        // 3. Apply the obstacle mask to the tiled product
        const maskedProduct = await sharp(tiledWall)
            .joinChannel(mask, { raw: { width: w, height: h, channels: 1 } })
            .png()
            .toBuffer();

        // 4. Generate the Lighting Map from the original wall zone
        // Normalizes greyscale image so that avgLuma becomes 255
        const lightingScale = 255 / avgLuma;
        const lightingMap = await croppedWallZone
            .greyscale()
            .linear(lightingScale, 0)
            .blur(1) // slightly smooth lighting details
            .png()
            .toBuffer();

        // 5. Build final composite layers:
        // First draw the masked product texture directly ('over')
        compositeOperations.push({
            input: maskedProduct,
            left: x,
            top: y,
            blend: 'over'
        });

        // Then multiply the lighting map on top of the product texture to cast shadows
        // We only want to multiply inside the mask, so we mask the lighting map too!
        const maskedLightingMap = await sharp(lightingMap)
            .joinChannel(mask, { raw: { width: w, height: h, channels: 1 } })
            .png()
            .toBuffer();

        compositeOperations.push({
            input: maskedLightingMap,
            left: x,
            top: y,
            blend: 'multiply'
        });
    }

    console.log("Compositing all layers onto original photo...");
    const finalImage = await sharp(IMAGE_PATH)
        .composite(compositeOperations)
        .png()
        .toBuffer();

    fs.writeFileSync(OUTPUT_PATH, finalImage);
    console.log("✅ Successfully saved test result to:", OUTPUT_PATH);
}

run().catch(console.error);
