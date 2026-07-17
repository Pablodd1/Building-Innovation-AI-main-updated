// =============================================================
// Server-Side Image Compositor — 100% Fidelity Product Rendering
// Uses Sharp for high-quality image manipulation.
// Replaces AI hallucination with exact database image compositing.
// =============================================================

import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";

// Disable Sharp cache to prevent memory leaks and reduce RAM usage on shared hosting
sharp.cache(false);

export interface CompositingRequest {
    originalImage: string;       // base64 data URL of user's photo
    material: {
        id?: string;
        refCode?: string;
        name?: string;
        category?: string;
        subcategory?: string;
        imageUrl?: string;       // URL or path to product image
        promptModifier?: string;
        usage?: string;          // "Interior", "Exterior", "Wall", "Ceiling", "Floor"
    };
    analysis?: {
        dimensions?: { width: number; height: number; areaM2: number };
        style?: string;
        lighting?: string;
        surfaces?: DetectedSurface[];
    };
    userInstruction?: string;
    renderOptions?: {
        lighting?: "SUNSET" | "NIGHT_LUXURY" | "NATURAL";
        opacity?: number;        // 0-1, default 1.0
    };
}

export interface DetectedSurface {
    type: "wall" | "floor" | "ceiling" | "countertop" | "other";
    bounds: { x: number; y: number; width: number; height: number };
    confidence: number;
}

export interface CompositingResult {
    image: string;               // base64 data URL of final image
    method: "composited" | "fallback";
    durationMs: number;
    details: {
        productImageUsed: string;
        transform: string;
        surfaceDetected: boolean;
    };
}

const SELF_URL = process.env.SITE_URL || "https://buildingapp.us";

function cleanBase64(dataURI: string): { data: Buffer; mimeType: string } {
    const match = dataURI.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!match) throw new Error("Invalid image data URI");
    return {
        mimeType: match[1],
        data: Buffer.from(match[2], "base64"),
    };
}

async function getProductImageBuffer(imageUrl?: string, refCode?: string): Promise<{ buffer: Buffer; width: number; height: number } | null> {
    // Resolve project root based on file location to handle Passenger/Hostinger cwd issues
    let projectRoot = process.cwd();
    try {
        if (typeof __dirname !== 'undefined') {
            projectRoot = path.resolve(__dirname, '..');
        }
    } catch (e) {}

    // 1. Try local refCode lookup first (e.g. 14031001.webp in products/ directory)
    if (refCode) {
        const localPaths = [
            path.join(projectRoot, "products", `${refCode}.webp`),
            path.join(process.cwd(), "products", `${refCode}.webp`),
            path.join(projectRoot, "product-webp", `${refCode}.webp`),
            path.join(process.cwd(), "product-webp", `${refCode}.webp`),
        ];
        for (const p of localPaths) {
            if (fs.existsSync(p)) {
                console.log(`[Compositor] Found product image locally at: ${p}`);
                const buffer = fs.readFileSync(p);
                const metadata = await sharp(buffer).metadata();
                return { buffer, width: metadata.width || 500, height: metadata.height || 500 };
            }
        }
    }

    if (!imageUrl) return null;

    // Try local file paths first
    const possiblePaths: string[] = [];
    
    if (imageUrl.startsWith(SELF_URL)) {
        const localPath = imageUrl.substring(SELF_URL.length);
        const cleanPath = localPath.startsWith("/") ? localPath.substring(1) : localPath;
        possiblePaths.push(
            path.join(projectRoot, "dist", cleanPath),
            path.join(process.cwd(), "dist", cleanPath),
            path.join(projectRoot, "public", cleanPath),
            path.join(projectRoot, cleanPath),
            path.join(process.cwd(), "public", cleanPath),
            path.join(process.cwd(), cleanPath),
            path.resolve(cleanPath)
        );
    } else if (imageUrl.startsWith("/")) {
        possiblePaths.push(
            path.join(projectRoot, "dist", imageUrl.substring(1)),
            path.join(process.cwd(), "dist", imageUrl.substring(1)),
            path.join(projectRoot, "public", imageUrl.substring(1)),
            path.join(projectRoot, imageUrl.substring(1)),
            path.join(process.cwd(), "public", imageUrl.substring(1)),
            path.join(process.cwd(), imageUrl.substring(1)),
            path.resolve(imageUrl.substring(1))
        );
    } else if (!imageUrl.startsWith("http")) {
        possiblePaths.push(
            path.join(projectRoot, "dist", imageUrl),
            path.join(process.cwd(), "dist", imageUrl),
            path.join(projectRoot, "public", imageUrl),
            path.join(projectRoot, imageUrl),
            path.join(process.cwd(), "public", imageUrl),
            path.join(process.cwd(), imageUrl),
            path.resolve(imageUrl)
        );
    }

    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            const buffer = fs.readFileSync(p);
            const metadata = await sharp(buffer).metadata();
            return { buffer, width: metadata.width || 500, height: metadata.height || 500 };
        }
    }

    // Fetch from URL
    if (imageUrl.startsWith("http")) {
        try {
            const response = await fetch(imageUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Referer': 'https://drive.google.com'
                }
            });
            if (!response.ok) return null;
            
            // Check if we got HTML instead of an image (e.g. Google Drive virus warning)
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('text/html')) {
                console.error('[imageCompositor] Received HTML instead of image from:', imageUrl);
                return null;
            }
            
            const buffer = Buffer.from(await response.arrayBuffer());
            const metadata = await sharp(buffer).metadata();
            return { buffer, width: metadata.width || 500, height: metadata.height || 500 };
        } catch (e: any) {
            console.error('[imageCompositor] Fetch error:', e.message);
            return null;
        }
    }

    return null;
}

/**
 * Detect WALL surfaces only.
 * Per product spec: "AI segmentation must specifically target and map to wall panels.
 * It must completely ignore interior floors, decks, and ceilings."
 *
 * Strategy:
 *   1. If AI-detected wall surfaces exist (from analyzeRoom), use them directly.
 *   2. Otherwise, infer the wall area as the space between the ceiling bottom and
 *      floor top, using AI-detected ceiling/floor bounds to narrow the region.
 *   3. Final fallback: top 10% to 72% of the image (typical interior wall zone).
 */
function detectTargetSurfaces(
    req: CompositingRequest,
    imgWidth: number,
    imgHeight: number
): Array<{ x: number; y: number; width: number; height: number; rotation: number }> {

    // --- Option 1: Use AI-detected wall surfaces directly ---
    if (req.analysis?.surfaces && req.analysis.surfaces.length > 0) {
        const wallSurfaces = req.analysis.surfaces.filter(
            (s: any) => s.type === "wall" && s.confidence > 0.4
        );
        if (wallSurfaces.length > 0) {
            console.log(`[Compositor] Using ${wallSurfaces.length} AI-detected wall surface(s)`);
            return wallSurfaces.map((s: any) => ({
                x: Math.round(s.bounds.x * imgWidth),
                y: Math.round(s.bounds.y * imgHeight),
                width: Math.round(s.bounds.width * imgWidth),
                height: Math.round(s.bounds.height * imgHeight),
                rotation: s.rotation || 0,
            }));
        }
    }

    // --- Option 2: Infer wall zone from ceiling/floor bounds ---
    let ceilingBottom = Math.round(imgHeight * 0.08);   // default: 8% from top
    let floorTop = Math.round(imgHeight * 0.72);         // default: 72% from top

    if (req.analysis?.surfaces && req.analysis.surfaces.length > 0) {
        const ceilingSurfaces = req.analysis.surfaces.filter(
            (s: any) => s.type === "ceiling" && s.confidence > 0.5
        );
        if (ceilingSurfaces.length > 0) {
            ceilingBottom = Math.max(
                ...ceilingSurfaces.map((s: any) =>
                    Math.round((s.bounds.y + s.bounds.height) * imgHeight)
                )
            );
        }

        const floorSurfaces = req.analysis.surfaces.filter(
            (s: any) => s.type === "floor" && s.confidence > 0.5
        );
        if (floorSurfaces.length > 0) {
            floorTop = Math.min(
                ...floorSurfaces.map((s: any) =>
                    Math.round(s.bounds.y * imgHeight)
                )
            );
        }
    }

    // Sanity clamps — be conservative to avoid painting onto ceiling structures or floor
    // Ceiling protection: never start above 18% of image (protects recessed lights, drop-ceiling grid)
    if (ceilingBottom < Math.round(imgHeight * 0.18)) ceilingBottom = Math.round(imgHeight * 0.18);
    // Floor protection: never go below 68% (protects baseboards, floor plane)
    if (floorTop > Math.round(imgHeight * 0.68) || floorTop <= Math.round(imgHeight * 0.4)) floorTop = Math.round(imgHeight * 0.68);

    const wallHeight = Math.max(1, floorTop - ceilingBottom);

    console.log(`[Compositor] Inferred wall zone: y=${ceilingBottom}→${floorTop} (${wallHeight}px)`);

    return [{
        x: 0,
        y: ceilingBottom,
        width: imgWidth,
        height: wallHeight,
        rotation: 0
    }];
}

/**
 * Render the product at a REALISTIC physical scale by tiling it.
 * 
 * Instead of stretching one image across the entire wall (which makes
 * a 30cm product look 3m wide), this calculates a tile size equivalent
 * to roughly 25-35% of wall height, preserves the product's aspect ratio,
 * then seamlessly repeats it across the surface — exactly like real wallpaper
 * or panel installation.
 *
 * @param productBuffer  Raw image buffer of the product
 * @param productWidth   Original product width in pixels
 * @param productHeight  Original product height in pixels
 * @param targetWidth    Wall zone width in pixels
 * @param targetHeight   Wall zone height in pixels
 * @param opacity        0-1 opacity for the overlay (default 0.88)
 */
async function renderProductTiledOnWall(
    productBuffer: Buffer,
    productWidth: number,
    productHeight: number,
    targetWidth: number,
    targetHeight: number,
    opacity: number = 0.88
): Promise<Buffer> {
    const aspect = productWidth / productHeight;

    // --- Realistic tile sizing ---
    // Strategy: calculate both height-driven and width-driven tile sizes, then pick
    // the one that gives the most visually realistic result.
    //
    // For a typical foam board / wall panel product:
    //   - Target ~3-4 tiles wide (so tileW ≈ wall_width / 3)
    //   - Target ~2-3 tiles tall (so tileH ≈ wall_height / 2)
    //   - Pick whichever gives larger tiles (better quality, fewer repetitions)
    //
    // This ensures portrait images (tall/narrow products) don't produce tiny tiles.

    // Width-driven: 1/3 of wall width per tile
    const tileW_byWidth = Math.round(targetWidth / 3);
    const tileH_byWidth = Math.round(tileW_byWidth / aspect);

    // Height-driven: 1/2 of wall height per tile
    const tileH_byHeight = Math.round(targetHeight / 2);
    const tileW_byHeight = Math.round(tileH_byHeight * aspect);

    // Use whichever gives the LARGER tile (more realistic, less repetition)
    let tileW: number, tileH: number;
    if (tileW_byWidth * tileH_byWidth >= tileW_byHeight * tileH_byHeight) {
        tileW = tileW_byWidth;
        tileH = tileH_byWidth;
    } else {
        tileW = tileW_byHeight;
        tileH = tileH_byHeight;
    }

    // Clamp to wall bounds (tile cannot exceed the wall area)
    tileW = Math.max(1, Math.min(tileW, targetWidth));
    tileH = Math.max(1, Math.min(tileH, targetHeight));

    console.log(`[Compositor] Tiling at realistic scale: tile=${tileW}x${tileH}px (wall=${targetWidth}x${targetHeight}) — approx ${Math.ceil(targetWidth/tileW)}x${Math.ceil(targetHeight/tileH)} grid`);

    // Resize product to the tile size
    const resizedTile = await sharp(productBuffer)
        .resize(tileW, tileH, { fit: "fill" })
        .png()
        .toBuffer();

    // Tile seamlessly across the full wall zone
    const tiledFull = await sharp({
        create: {
            width: targetWidth,
            height: targetHeight,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 0 }
        }
    })
    .composite([{ input: resizedTile, tile: true, blend: "over" }])
    .png()
    .toBuffer();

    // Apply desired opacity
    // Sharp's ensureAlpha(alpha) sets the INITIAL alpha channel value (0-1)
    // We achieve opacity by modulating the existing alpha with a flat alpha layer
    const withOpacity = await sharp(tiledFull)
        .composite([{
            input: {
                create: {
                    width: targetWidth,
                    height: targetHeight,
                    channels: 4,
                    background: { r: 0, g: 0, b: 0, alpha: opacity }
                }
            },
            blend: "dest-in" as any
        }])
        .png()
        .toBuffer();

    return withOpacity;
}

/**
 * Main compositing function.
 * 1. Loads user's photo
 * 2. Loads product image
 * 3. Chooses blend mode based on product brightness
 * 4. Tiles product to cover target surfaces
 * 5. Blends onto user photo
 */
export async function compositeProductOntoPhoto(
    req: CompositingRequest
): Promise<CompositingResult> {
    const startTime = Date.now();

    try {
        // 1. Parse user's photo
        const { data: userPhotoData, mimeType: userPhotoMime } = cleanBase64(req.originalImage);
        const userPhoto = sharp(userPhotoData);
        const userMeta = await userPhoto.metadata();
        const imgWidth = userMeta.width || 800;
        const imgHeight = userMeta.height || 600;

        // 2. Load product image (100% from database)
        const productInfo = await getProductImageBuffer(req.material.imageUrl, req.material.refCode || req.material.id);
        if (!productInfo) {
            throw new Error(`Product image not found: ${req.material.imageUrl}`);
        }

        // 3. Detect where to place the product
        const targets = detectTargetSurfaces(req, imgWidth, imgHeight);

        // 4. Build composite operations for all targets
        const category = req.material.category || "";
        const compositeOperations = [];

        for (const target of targets) {
            // Clamp target bounds to fit strictly inside the image
            const x = Math.max(0, Math.min(target.x, imgWidth - 1));
            const y = Math.max(0, Math.min(target.y, imgHeight - 1));
            const width = Math.max(1, Math.min(target.width, imgWidth - x));
            const height = Math.max(1, Math.min(target.height, imgHeight - y));

            console.log(`[Compositor] Rendering product on wall zone: x=${x} y=${y} w=${width} h=${height}`);

            // --- Step 1: Build a foreground protection mask ---
            // The mask is WHITE where we should draw the product (open wall area)
            // and BLACK where we should leave the original (furniture, plants, objects in front of wall).
            // We use luminance thresholding: bright pixels = wall, dark pixels = furniture/foreground.
            const croppedWallZone = sharp(userPhotoData).extract({ left: x, top: y, width, height });
            const { channels } = await croppedWallZone.stats();
            const avgLuma = (channels[0].mean + channels[1].mean + channels[2].mean) / 3;
            // Threshold: avgLuma - 20 ensures furniture slightly darker than wall gets masked out.
            // Clamped 60–200 to stay meaningful across very bright or very dark rooms.
            const thresholdValue = Math.max(60, Math.min(200, Math.round(avgLuma - 20)));
            console.log(`[Compositor] Wall zone mean luma: ${avgLuma.toFixed(1)}, mask threshold: ${thresholdValue}`);

            let mask = await croppedWallZone
                .greyscale()
                .threshold(thresholdValue)
                .blur(2)   // smooth edges so the overlay doesn't have hard pixel borders
                .raw()
                .toBuffer();

            // Low-light fallback: if mask is nearly all black (< 15% white), the room
            // is too dark or low-contrast to distinguish wall from objects.
            // In that case, fill the mask solid white so we render on the entire zone.
            const whitePixels = mask.reduce((n: number, v: number) => n + (v > 128 ? 1 : 0), 0);
            const coverage = whitePixels / mask.length;
            console.log(`[Compositor] Mask coverage: ${(coverage * 100).toFixed(1)}%`);
            if (coverage < 0.15) {
                console.log(`[Compositor] Low coverage, using solid fallback mask`);
                mask.fill(255);
            }

            // --- Step 2: Tile the product at realistic physical scale ---
            const productLayer = await renderProductTiledOnWall(
                productInfo.buffer,
                productInfo.width,
                productInfo.height,
                width,
                height,
                1.0  // full opacity — the mask controls where it appears, not opacity
            );

            // --- Step 3: Apply the mask as the product's alpha channel ---
            // This cuts out the product everywhere the mask is black (furniture, objects)
            // so only the open wall area gets the texture.
            const maskedProduct = await sharp(productLayer)
                .joinChannel(mask, {
                    raw: { width, height, channels: 1 }
                })
                .png()
                .toBuffer();

            // --- Step 4: Multiply blend preserves room lighting through the product ---
            // multiply: product_color × wall_color — keeps shadows, highlights, depth.
            // This is how real material visualization tools (like Roomvo, Houzz AR) work.
            compositeOperations.push({
                input: maskedProduct,
                left: x,
                top: y,
                blend: "multiply" as any
            });

            // --- Step 5: Soft-light recovery pass ---
            // Multiply tends to darken bright materials. A 40% opacity soft-light pass
            // recovers the product's true colors without losing the shadow integration.
            const recoveryLayer = await sharp(maskedProduct)
                .ensureAlpha(0.4)
                .png()
                .toBuffer();

            compositeOperations.push({
                input: recoveryLayer,
                left: x,
                top: y,
                blend: "soft-light" as any
            });
        }

        // 5. Composite all layers onto user's photo
        const compositeImage = await sharp(userPhotoData)
            .composite(compositeOperations)
            .jpeg({ quality: 95 })
            .toBuffer();

        const durationMs = Date.now() - startTime;

        return {
            image: `data:image/jpeg;base64,${compositeImage.toString("base64")}`,
            method: "composited",
            durationMs,
            details: {
                productImageUsed: req.material.imageUrl || "unknown",
                transform: `scaled to cover x${targets.length} surfaces, luma-shaded over`,
                surfaceDetected: !!req.analysis?.surfaces,
            },
        };
    } catch (error: any) {
        console.error("[Compositor] Error:", error.stack || error.message);
        
        return {
            image: req.originalImage,
            method: "fallback",
            durationMs: Date.now() - startTime,
            details: {
                productImageUsed: req.material.imageUrl || "unknown",
                transform: "error-fallback",
                surfaceDetected: false,
            },
        };
    }
}
