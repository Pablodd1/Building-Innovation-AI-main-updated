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

    // Sanity clamps
    if (ceilingBottom >= imgHeight * 0.4) ceilingBottom = Math.round(imgHeight * 0.08);
    if (floorTop <= imgHeight * 0.4 || floorTop > imgHeight) floorTop = Math.round(imgHeight * 0.72);

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
 * Resize the product image to completely fill the target surface.
 * Uses fit:'fill' (stretches to exact dimensions) so the full product
 * is always visible with no cropping, no tiling, no cascade.
 */
async function scaleProductToFill(
    productBuffer: Buffer,
    targetWidth: number,
    targetHeight: number,
    opacity: number = 0.85
): Promise<Buffer> {
    console.log(`[Compositor] Scaling product to fill ${targetWidth}x${targetHeight} at ${Math.round(opacity * 100)}% opacity`);

    // Stretch product to exactly fill the wall zone (no cropping, no tiling)
    const scaledBuffer = await sharp(productBuffer)
        .resize(targetWidth, targetHeight, { fit: "fill" })
        .png()
        .toBuffer();

    // Apply opacity by adjusting the alpha channel (ensureAlpha takes 0-1 float)
    const withAlpha = await sharp(scaledBuffer)
        .ensureAlpha(opacity)
        .png()
        .toBuffer();

    return withAlpha;
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

            // Scale product to fill the wall zone exactly (no tiling, no cropping)
            const productLayer = await scaleProductToFill(
                productInfo.buffer,
                width,
                height,
                req.renderOptions?.opacity ?? 0.85
            );

            // Composite product directly over the wall zone using normal 'over' blend
            compositeOperations.push({
                input: productLayer,
                left: x,
                top: y,
                blend: "over" as any
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
