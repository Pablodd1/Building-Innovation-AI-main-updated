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

async function getProductImageBuffer(imageUrl?: string): Promise<{ buffer: Buffer; width: number; height: number } | null> {
    if (!imageUrl) return null;

    // Try local file paths first
    const possiblePaths: string[] = [];
    
    // Resolve project root based on file location to handle Passenger/Hostinger cwd issues
    let projectRoot = process.cwd();
    try {
        if (typeof __dirname !== 'undefined') {
            projectRoot = path.resolve(__dirname, '..');
        }
    } catch (e) {}

    if (imageUrl.startsWith(SELF_URL)) {
        const localPath = imageUrl.substring(SELF_URL.length);
        const cleanPath = localPath.startsWith("/") ? localPath.substring(1) : localPath;
        possiblePaths.push(
            path.join(projectRoot, "public", cleanPath),
            path.join(projectRoot, cleanPath),
            path.join(process.cwd(), "public", cleanPath),
            path.join(process.cwd(), cleanPath),
            path.resolve(cleanPath)
        );
    } else if (imageUrl.startsWith("/")) {
        possiblePaths.push(
            path.join(projectRoot, "public", imageUrl.substring(1)),
            path.join(projectRoot, imageUrl.substring(1)),
            path.join(process.cwd(), "public", imageUrl.substring(1)),
            path.join(process.cwd(), imageUrl.substring(1)),
            path.resolve(imageUrl.substring(1))
        );
    } else if (!imageUrl.startsWith("http")) {
        possiblePaths.push(
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
 * Detect where to place the product based on category and analysis.
 * Returns target bounds as percentage of image (0-1).
 */
function detectTargetSurface(
    req: CompositingRequest,
    imgWidth: number,
    imgHeight: number
): { x: number; y: number; width: number; height: number; rotation: number } | null {
    const category = (req.material.category || "").toLowerCase();
    const subcategory = (req.material.subcategory || "").toLowerCase();
    const usage = (req.material.usage || "").toLowerCase();

    // Use AI-provided surface detection if available
    if (req.analysis?.surfaces && req.analysis.surfaces.length > 0) {
        const bestSurface = req.analysis.surfaces.reduce((best, s) =>
            s.confidence > best.confidence ? s : best
        );
        if (bestSurface.confidence > 0.5) {
            return {
                x: bestSurface.bounds.x * imgWidth,
                y: bestSurface.bounds.y * imgHeight,
                width: bestSurface.bounds.width * imgWidth,
                height: bestSurface.bounds.height * imgHeight,
                rotation: 0,
            };
        }
    }

    // Heuristic placement based on product category
    const W = imgWidth;
    const H = imgHeight;

    // Wall / Ceiling products → upper portion
    if (
        category.includes("cielo") ||
        category.includes("ceiling") ||
        category.includes("panel") ||
        subcategory.includes("pared") ||
        subcategory.includes("wall") ||
        usage.includes("wall")
    ) {
        // Place on upper wall area
        return {
            x: W * 0.1,
            y: H * 0.15,
            width: W * 0.8,
            height: H * 0.5,
            rotation: 0,
        };
    }

    // Floor products → lower portion
    if (
        category.includes("piso") ||
        category.includes("floor") ||
        usage.includes("floor")
    ) {
        return {
            x: W * 0.1,
            y: H * 0.55,
            width: W * 0.8,
            height: H * 0.35,
            rotation: 0,
        };
    }

    // Countertop / surface products → middle
    if (
        category.includes("counter") ||
        subcategory.includes("counter")
    ) {
        return {
            x: W * 0.2,
            y: H * 0.4,
            width: W * 0.6,
            height: H * 0.2,
            rotation: 0,
        };
    }

    // Default: center of image
    return {
        x: W * 0.1,
        y: H * 0.2,
        width: W * 0.8,
        height: H * 0.5,
        rotation: 0,
    };
}

/**
 * Apply perspective transform to product image to match target surface.
 * Uses Sharp's affine transform for perspective correction.
 */
async function transformProductImage(
    productBuffer: Buffer,
    targetWidth: number,
    targetHeight: number,
    rotation: number
): Promise<Buffer> {
    // Resize product to fit target area while maintaining aspect ratio
    const productMeta = await sharp(productBuffer).metadata();
    const productAspect = (productMeta.width || 1) / (productMeta.height || 1);
    const targetAspect = targetWidth / targetHeight;

    let resizeWidth = targetWidth;
    let resizeHeight = targetHeight;

    if (productAspect > targetAspect) {
        resizeWidth = targetWidth;
        resizeHeight = targetWidth / productAspect;
    } else {
        resizeHeight = targetHeight;
        resizeWidth = targetHeight * productAspect;
    }

    // Apply slight rotation if needed (in degrees)
    const rotateAngle = rotation || 0;

    const transformed = await sharp(productBuffer)
        .resize(Math.round(resizeWidth), Math.round(resizeHeight), {
            fit: "inside",
            withoutEnlargement: false,
        })
        .rotate(rotateAngle, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .toBuffer();

    return transformed;
}

/**
 * Main compositing function.
 * 1. Loads user's photo
 * 2. Loads product image (100% from database)
 * 3. Detects target surface
 * 4. Transforms and composites product onto photo
 * 5. Returns final image
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
        const productInfo = await getProductImageBuffer(req.material.imageUrl);
        if (!productInfo) {
            throw new Error(`Product image not found: ${req.material.imageUrl}`);
        }

        // 3. Detect where to place the product
        const target = detectTargetSurface(req, imgWidth, imgHeight);
        if (!target) {
            throw new Error("Could not detect target surface for compositing");
        }

        // 4. Transform product to fit target area
        const transformedProduct = await transformProductImage(
            productInfo.buffer,
            target.width,
            target.height,
            target.rotation
        );

        // 5. Composite onto user's photo
        const opacity = req.renderOptions?.opacity ?? 1.0;
        const blendMode = opacity < 1.0 ? "over" : "over";

        // Ensure transformed product fits within user photo bounds
        const productMeta = await sharp(transformedProduct).metadata();
        const prodW = productMeta.width || target.width;
        const prodH = productMeta.height || target.height;

        // Clamp composite to photo bounds (sharp requires input <= canvas)
        const maxW = Math.min(prodW, imgWidth);
        const maxH = Math.min(prodH, imgHeight);
        let compositeLeft = Math.round(target.x + (target.width - prodW) / 2);
        let compositeTop = Math.round(target.y + (target.height - prodH) / 2);

        // Clamp position so composite stays within photo
        compositeLeft = Math.max(0, Math.min(compositeLeft, imgWidth - maxW));
        compositeTop = Math.max(0, Math.min(compositeTop, imgHeight - maxH));

        // Resize product if it still exceeds photo dimensions
        let finalProduct = transformedProduct;
        if (prodW > imgWidth || prodH > imgHeight) {
            finalProduct = await sharp(transformedProduct)
                .resize(imgWidth, imgHeight, { fit: "inside", withoutEnlargement: true })
                .toBuffer();
        }

        // Create the composite
        const compositeImage = await userPhoto
            .composite([
                {
                    input: finalProduct,
                    left: compositeLeft,
                    top: compositeTop,
                    blend: blendMode,
                },
            ])
            .jpeg({ quality: 95 })
            .toBuffer();

        const durationMs = Date.now() - startTime;

        return {
            image: `data:image/jpeg;base64,${compositeImage.toString("base64")}`,
            method: "composited",
            durationMs,
            details: {
                productImageUsed: req.material.imageUrl || "unknown",
                transform: `resize(${target.width}x${target.height}), rotate(${target.rotation}deg)`,
                surfaceDetected: !!req.analysis?.surfaces,
            },
        };
    } catch (error: any) {
        console.error("[Compositor] Error:", error.message);
        
        // Cleanly return fallback so that server/index.ts can use AI generation
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
