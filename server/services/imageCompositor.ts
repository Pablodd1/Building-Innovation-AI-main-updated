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
    polygon?: Array<[number, number]>;
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

async function cropProductTexture(buffer: Buffer): Promise<{ buffer: Buffer; width: number; height: number } | null> {
    try {
        const metadata = await sharp(buffer).metadata();
        const width = metadata.width || 500;
        const height = metadata.height || 500;

        // Crop center 20% width and 80% height to extract the clean texture strip
        const cropW = Math.round(width * 0.20);
        const cropH = Math.round(height * 0.80);
        const cropX = Math.round((width - cropW) / 2);
        const cropY = Math.round((height - cropH) / 2);

        const croppedBuffer = await sharp(buffer)
            .extract({ left: cropX, top: cropY, width: cropW, height: cropH })
            .png()
            .toBuffer();

        return { buffer: croppedBuffer, width: cropW, height: cropH };
    } catch (e: any) {
        console.error("[Compositor] Error cropping product texture:", e.message);
        return null;
    }
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
                return await cropProductTexture(buffer);
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
            return await cropProductTexture(buffer);
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
            return await cropProductTexture(buffer);
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
): Array<{ x: number; y: number; width: number; height: number; rotation: number; polygon?: Array<[number, number]> }> {

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
                polygon: Array.isArray(s.polygon) ? s.polygon : undefined,
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

    // Ensure we maintain the exact aspect ratio of the product texture
    let tileW = targetWidth;
    let tileH = targetHeight;
    
    // Default: scale the texture so it spans the full height of the wall target.
    // This is perfect for vertical wall panels, wallpaper, and slats.
    tileH = targetHeight;
    tileW = Math.round(tileH * aspect);
    
    // If the resulting tile is wider than the wall (e.g. horizontal siding or floors),
    // scale it so it spans the full width of the wall instead.
    if (tileW > targetWidth) {
        tileW = targetWidth;
        tileH = Math.round(tileW / aspect);
    }
    
    // Ensure minimum size of 1px
    tileW = Math.max(1, tileW);
    tileH = Math.max(1, tileH);

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

        // 3. Detect where to place the product.
        // IMPORTANT: detectTargetSurfaces ALWAYS returns at least one target —
        // either AI-detected wall surfaces, an inferred wall zone from
        // ceiling/floor bounds, or a sensible default (top 18% → 68% of image).
        // So we proceed with compositing regardless of whether AI analysis
        // succeeded. Surrendering to the AI generator here was the cause of
        // the "product doesn't appear on the wall" regression: every time
        // Gemini went down, the compositor bailed out instead of using its
        // built-in wall-zone fallback, and the route then failed completely.
        const targets = detectTargetSurfaces(req, imgWidth, imgHeight);
        const hasAnalysis = !!(req.analysis?.surfaces && req.analysis.surfaces.length > 0);
        console.log(`[Compositor] Compositing onto ${targets.length} target(s) (AI analysis: ${hasAnalysis ? "yes" : "no, using inferred wall zone"})`);

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

            // --- Step 1: Extract wall area lighting metrics ---
            const croppedWallZone = sharp(userPhotoData).extract({ left: x, top: y, width, height });
            const { channels } = await croppedWallZone.stats();
            const avgLuma = (channels[0].mean + channels[1].mean + channels[2].mean) / 3;

            // --- Step 1b: Build a vector-accurate mask using AI-detected polygon and obstacles ---
            let mask: Buffer;

            if (target.polygon && target.polygon.length >= 3) {
                try {
                    const pointsSvg = target.polygon
                        .map(([px, py]) => `${Math.round(px * imgWidth - x)},${Math.round(py * imgHeight - y)}`)
                        .join(" ");
                    const svgBuffer = Buffer.from(
                        `<svg width="${width}" height="${height}"><polygon points="${pointsSvg}" fill="white"/></svg>`
                    );
                    const pngMask = await sharp(svgBuffer).extractChannel("green").raw().toBuffer();
                    mask = Buffer.from(pngMask);
                    console.log(`[Compositor] Created SVG polygon mask for angled wall with ${target.polygon.length} corners`);
                } catch (e: any) {
                    console.warn(`[Compositor] Could not render polygon mask, defaulting to bounding box:`, e.message);
                    mask = Buffer.alloc(width * height, 255);
                }
            } else {
                mask = Buffer.alloc(width * height, 255); // Solid white box mask by default
            }

            if (req.analysis?.surfaces && req.analysis.surfaces.length > 0) {
                const nonWallSurfaces = req.analysis.surfaces.filter(
                    (s: any) => s.type !== "wall" && s.bounds
                );
                for (const s of nonWallSurfaces) {
                    const sx = Math.round(s.bounds.x * imgWidth);
                    const sy = Math.round(s.bounds.y * imgHeight);
                    const sw = Math.round(s.bounds.width * imgWidth);
                    const sh = Math.round(s.bounds.height * imgHeight);

                    // Compute intersection with the current target wall zone (x, y, width, height)
                    const left = Math.max(x, sx);
                    const top = Math.max(y, sy);
                    const right = Math.min(x + width, sx + sw);
                    const bottom = Math.min(y + height, sy + sh);

                    if (right > left && bottom > top) {
                        console.log(`[Compositor] Masking out obstacle (${s.type}) at relative x:${left - x} y:${top - y} w:${right - left} h:${bottom - top}`);
                        for (let row = top; row < bottom; row++) {
                            const maskY = row - y;
                            const rowStart = maskY * width;
                            for (let col = left; col < right; col++) {
                                const maskX = col - x;
                                mask[rowStart + maskX] = 0; // Black out obstacle
                            }
                        }
                    }
                }
            }

            // --- Step 2: Tile the product at realistic physical scale ---
            const productLayer = await renderProductTiledOnWall(
                productInfo.buffer,
                productInfo.width,
                productInfo.height,
                width,
                height,
                1.0  // full opacity
            );

            // --- Step 3: Apply the obstacle mask as the product's alpha ---
            // The productLayer from renderProductTiledOnWall is already RGBA.
            // To cut out obstacles, we composite the obstacle mask (white =
            // visible, black = obstacle/transparent) ON TOP of the tile using
            // the "dest-in" blend: dest-in keeps destination pixels only
            // where the source mask is opaque. So where the mask is black
            // (obstacle), the tile becomes transparent.
            //
            // We tried joinChannel earlier but it either appended a 5th
            // channel (no-op) or, after flatten, baked white into the RGB
            // before masking. composite(dest-in) is the canonical way to
            // apply an alpha mask in sharp and avoids both pitfalls.
            const maskImage = await sharp(mask, {
                raw: { width, height, channels: 1 }
            })
                .toColorspace("b-w")
                .png()
                .toBuffer();
            const maskedProduct = await sharp(productLayer)
                .composite([{
                    input: maskImage,
                    blend: "dest-in" as any
                }])
                .png()
                .toBuffer();

            // --- Step 4: Generate the lighting shadow/highlight map ---
            const safeAvgLuma = Math.max(30, avgLuma);
            const lightingScale = 255 / safeAvgLuma;
            const lightingMap = await croppedWallZone
                .greyscale()
                .linear(lightingScale, 0)
                .blur(1) // slightly smooth shadow transitions
                .png()
                .toBuffer();

            // Apply the same obstacle mask to the lighting map so we don't
            // darken furniture shadows with multiply blend.
            const maskedLightingMap = await sharp(lightingMap)
                .ensureAlpha()
                .composite([{
                    input: maskImage,
                    blend: "dest-in" as any
                }])
                .png()
                .toBuffer();

            // --- Step 5: Composite product with Over blend, and Lighting with Multiply blend ---
            compositeOperations.push({
                input: maskedProduct,
                left: x,
                top: y,
                blend: "over" as any
            });

            compositeOperations.push({
                input: maskedLightingMap,
                left: x,
                top: y,
                blend: "multiply" as any
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

/**
 * Build an OpenAI-compatible inpainting mask from room analysis surfaces.
 *
 * OpenAI's images.edit mask convention (opposite of the compositor's internal
 * mask): transparent pixels (alpha = 0) = "edit / inpaint here", opaque pixels
 * (alpha = 255) = "preserve". We want the model to inpaint ONLY the wall
 * regions and preserve everything else (furniture, floor, ceiling, obstacles).
 *
 * Strategy (reuses the same surface-filtering logic as the compositor):
 *   1. Read the image dimensions from the actual photo buffer (the analysis
 *      bounds are normalized 0.0-1.0 and need to be scaled to real pixels).
 *   2. Allocate a single-channel buffer the size of the image, init to 0
 *      (nothing is editable yet — fully opaque mask).
 *   3. For each "wall" surface (confidence > 0.4), set its bounding-box
 *      pixels to 255 (editable). If the wall has a 4-corner polygon, use it
 *      instead of the bbox for accurate angled-wall coverage.
 *   4. For each NON-wall surface (obstacles), clear its bbox back to 0 so
 *      cabinets/furniture/TVs/windows are preserved even if they overlap a
 *      wall's bbox.
 *   5. Convert that buffer to an RGBA PNG where alpha = (255 - maskValue).
 *      Mask 255 (wall, editable) → alpha 0 (transparent, edit). Mask 0
 *      (preserve) → alpha 255 (opaque, keep). Done via the dest-out blend
 *      against an opaque canvas — same idiom the compositor uses, just
 *      inverted intent.
 *
 * Returns null if there are no usable wall surfaces, so the caller can fall
 * back to a no-mask edit.
 */
export async function buildOpenAIWallMask(
    imageBuffer: Buffer,
    analysis: { surfaces?: any[] } | undefined,
    surfaces: any[] | undefined
): Promise<Buffer | null> {
    const allSurfaces = surfaces ?? analysis?.surfaces;
    if (!allSurfaces || !Array.isArray(allSurfaces) || allSurfaces.length === 0) {
        return null;
    }

    // Get the real pixel dimensions of the user's photo
    const meta = await sharp(imageBuffer).metadata();
    const imgWidth = meta.width || 800;
    const imgHeight = meta.height || 600;

    const wallSurfaces = allSurfaces.filter(
        (s: any) => s.type === "wall" && (s.confidence ?? 0) > 0.4
    );
    if (wallSurfaces.length === 0) {
        return null;
    }

    // 1-channel mask buffer: 255 = wall (editable), 0 = preserve.
    const mask = Buffer.alloc(imgWidth * imgHeight, 0);

    const fillRect = (mx: number, my: number, mw: number, mh: number, value: number) => {
        const x0 = Math.max(0, Math.min(mx, imgWidth - 1));
        const y0 = Math.max(0, Math.min(my, imgHeight - 1));
        const x1 = Math.max(0, Math.min(mx + mw, imgWidth));
        const y1 = Math.max(0, Math.min(my + mh, imgHeight));
        for (let y = y0; y < y1; y++) {
            const rowStart = y * imgWidth;
            for (let x = x0; x < x1; x++) {
                mask[rowStart + x] = value;
            }
        }
    };

    // Shared polygon rasterizer: paints pixels inside the polygon with `value`.
    // Uses SVG → sharp → single channel → OR. Same approach for walls and
    // obstacles so both get perspective-accurate masks, not bounding boxes.
    const paintPolygon = async (polygon: any[], value: number) => {
        const pts = polygon
            .map(([px, py]: [number, number]) =>
                `${Math.round(px * imgWidth)},${Math.round(py * imgHeight)}`)
            .join(" ");
        const svg = Buffer.from(
            `<svg width="${imgWidth}" height="${imgHeight}"><polygon points="${pts}" fill="white"/></svg>`
        );
        const polyChannel = await sharp(svg).extractChannel("green").raw().toBuffer();
        for (let i = 0; i < mask.length; i++) {
            if (polyChannel[i] > 127) mask[i] = value;
        }
    };

    // Mark wall regions as editable (255). Prefer polygon if present.
    for (const w of wallSurfaces) {
        if (Array.isArray(w.polygon) && w.polygon.length >= 3) {
            try {
                await paintPolygon(w.polygon, 255);
            } catch {
                // polygon rasterization failed — fall back to the wall's bbox
                if (w.bounds) {
                    fillRect(
                        Math.round(w.bounds.x * imgWidth),
                        Math.round(w.bounds.y * imgHeight),
                        Math.round(w.bounds.width * imgWidth),
                        Math.round(w.bounds.height * imgHeight),
                        255
                    );
                }
            }
        } else if (w.bounds) {
            fillRect(
                Math.round(w.bounds.x * imgWidth),
                Math.round(w.bounds.y * imgHeight),
                Math.round(w.bounds.width * imgWidth),
                Math.round(w.bounds.height * imgHeight),
                255
            );
        }
    }

    // Cut out obstacles (anything that isn't a wall) so furniture/cabinets/
    // windows/TVs are preserved even when they sit in front of a wall.
    // Prefer polygon when present — bounding boxes over-carve into walls on
    // all four sides (a TV's bbox includes empty wall above/below the TV),
    // which leaves visible gaps in the rendered material around obstacles.
    const obstacles = allSurfaces.filter(
        (s: any) => s.type !== "wall" && s.bounds
    );
    for (const s of obstacles) {
        if (Array.isArray(s.polygon) && s.polygon.length >= 3) {
            try {
                await paintPolygon(s.polygon, 0);
                continue;
            } catch {
                // fall through to bbox
            }
        }
        fillRect(
            Math.round(s.bounds.x * imgWidth),
            Math.round(s.bounds.y * imgHeight),
            Math.round(s.bounds.width * imgWidth),
            Math.round(s.bounds.height * imgHeight),
            0
        );
    }

    // Convert to an OpenAI-style RGBA PNG: alpha=0 where mask=255 (wall, edit),
    // alpha=255 where mask=0 (preserve). We build the RGBA buffer directly
    // pixel-by-pixel rather than using dest-out, because dest-out's behavior
    // with a single-channel greyscale input is unreliable (sharp treats a
    // no-alpha input as fully opaque, which removes everything). Direct
    // construction is unambiguous and easy to verify.
    const rgba = Buffer.alloc(imgWidth * imgHeight * 4);
    for (let i = 0; i < mask.length; i++) {
        rgba[i * 4 + 0] = 0;       // R
        rgba[i * 4 + 1] = 0;       // G
        rgba[i * 4 + 2] = 0;       // B
        // mask=255 (wall, editable) → alpha=0 (transparent, inpaint here)
        // mask=0   (preserve)       → alpha=255 (opaque, keep)
        rgba[i * 4 + 3] = 255 - mask[i];
    }

    const rgbaMask = await sharp(rgba, {
        raw: { width: imgWidth, height: imgHeight, channels: 4 }
    })
        .png()
        .toBuffer();

    console.log(`[OpenAIMask] Built ${imgWidth}x${imgHeight} mask: ${wallSurfaces.length} walls, ${obstacles.length} obstacles preserved`);
    return rgbaMask;
}

/**
 * Build a binary (1-channel grayscale) inpaint mask from analysis surfaces.
 * White (255) = edit, Black (0) = preserve. This is the format FLUX Fill,
 * SDXL Inpaint, and most non-OpenAI diffusion inpainters expect (vs. the
 * RGBA alpha-style mask OpenAI's images.edit uses above).
 *
 * Same wall/obstacle logic as buildOpenAIWallMask — both must stay in sync.
 * Centralizing the rasterization in one place would be cleaner, but the two
 * output formats differ enough that we keep two thin builders over a shared
 * rasterizer (paintPolygon inline above) instead.
 */
export async function buildBinaryWallMask(
    imageBuffer: Buffer,
    analysis: { surfaces?: any[] } | undefined,
    surfaces: any[] | undefined
): Promise<Buffer | null> {
    const allSurfaces = surfaces ?? analysis?.surfaces;
    if (!allSurfaces || !Array.isArray(allSurfaces) || allSurfaces.length === 0) {
        return null;
    }

    const meta = await sharp(imageBuffer).metadata();
    const imgWidth = meta.width || 800;
    const imgHeight = meta.height || 600;

    const wallSurfaces = allSurfaces.filter(
        (s: any) => s.type === "wall" && (s.confidence ?? 0) > 0.4
    );
    if (wallSurfaces.length === 0) {
        return null;
    }

    // 1-channel mask: 255 = wall (edit), 0 = preserve. Start all black.
    const mask = Buffer.alloc(imgWidth * imgHeight, 0);

    const fillRect = (mx: number, my: number, mw: number, mh: number, value: number) => {
        const x0 = Math.max(0, Math.min(mx, imgWidth - 1));
        const y0 = Math.max(0, Math.min(my, imgHeight - 1));
        const x1 = Math.max(0, Math.min(mx + mw, imgWidth));
        const y1 = Math.max(0, Math.min(my + mh, imgHeight));
        for (let y = y0; y < y1; y++) {
            const rowStart = y * imgWidth;
            for (let x = x0; x < x1; x++) {
                mask[rowStart + x] = value;
            }
        }
    };

    const paintPolygon = async (polygon: any[], value: number) => {
        const pts = polygon
            .map(([px, py]: [number, number]) =>
                `${Math.round(px * imgWidth)},${Math.round(py * imgHeight)}`)
            .join(" ");
        const svg = Buffer.from(
            `<svg width="${imgWidth}" height="${imgHeight}"><polygon points="${pts}" fill="white"/></svg>`
        );
        const polyChannel = await sharp(svg).extractChannel("green").raw().toBuffer();
        for (let i = 0; i < mask.length; i++) {
            if (polyChannel[i] > 127) mask[i] = value;
        }
    };

    for (const w of wallSurfaces) {
        if (Array.isArray(w.polygon) && w.polygon.length >= 3) {
            try { await paintPolygon(w.polygon, 255); }
            catch {
                if (w.bounds) fillRect(
                    Math.round(w.bounds.x * imgWidth),
                    Math.round(w.bounds.y * imgHeight),
                    Math.round(w.bounds.width * imgWidth),
                    Math.round(w.bounds.height * imgHeight),
                    255
                );
            }
        } else if (w.bounds) {
            fillRect(
                Math.round(w.bounds.x * imgWidth),
                Math.round(w.bounds.y * imgHeight),
                Math.round(w.bounds.width * imgWidth),
                Math.round(w.bounds.height * imgHeight),
                255
            );
        }
    }

    const obstacles = allSurfaces.filter(
        (s: any) => s.type !== "wall" && s.bounds
    );
    for (const s of obstacles) {
        if (Array.isArray(s.polygon) && s.polygon.length >= 3) {
            try { await paintPolygon(s.polygon, 0); continue; } catch { /* fall through */ }
        }
        fillRect(
            Math.round(s.bounds.x * imgWidth),
            Math.round(s.bounds.y * imgHeight),
            Math.round(s.bounds.width * imgWidth),
            Math.round(s.bounds.height * imgHeight),
            0
        );
    }

    // Emit a grayscale PNG. fal.ai / FLUX Fill accept either a single PNG with
    // white=fill/black=keep OR an RGBA mask with alpha. We use the grayscale
    // form because it is unambiguous and smaller.
    const binary = await sharp(mask, {
        raw: { width: imgWidth, height: imgHeight, channels: 1 }
    })
        .png()
        .toBuffer();

    console.log(`[BinaryMask] Built ${imgWidth}x${imgHeight} binary mask: ${wallSurfaces.length} walls, ${obstacles.length} obstacles preserved`);
    return binary;
}
