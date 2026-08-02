// =============================================================
// SAM 3 Segmentation Service
// =============================================================
// Calls Meta's SAM 3 (Segment Anything 3) via fal.ai to produce
// pixel-accurate alpha masks for room surfaces. This replaces
// gpt-4o's coordinate-based geometry (which emits axis-aligned
// rectangles due to its 512px internal tile ceiling) with true
// pixel segmentation.
//
// WHY: gpt-4o is a semantics model, not a geometry model. SAM 3
// is purpose-built for pixel-accurate segmentation and handles
// perspective-distorted walls/floors correctly. Verified Aug 2026
// across 5 diverse room photos — wall detection 5/5 correct.
//
// API: https://fal.run/fal-ai/sam-3/image
// Schema: { image_url, prompt } → { masks: [{ url, width, height }] }
// Mask format: RGBA PNG where alpha=255 = segmented, alpha=0 = not.
// Cost: ~$0.002 per call. Latency: ~2s per call (parallelizable).

import sharp from "sharp";

const SAM3_ENDPOINT = "https://fal.run/fal-ai/sam-3/image";

export interface SegmentationMask {
    type: string;          // "wall", "floor", "ceiling", or furniture class
    alphaBuffer: Buffer;   // raw 1-channel alpha (0-255), dimensions = maskWidth x maskHeight
    width: number;
    height: number;
    opaquePercent: number; // sanity metric — what fraction of the mask is opaque
}

/**
 * Segment the given room photo for the requested surface types using SAM 3.
 * Calls run in parallel for speed (~2s total vs ~6s sequential for 3 types).
 *
 * Returns a map of { type → SegmentationMask }. Types that SAM 3 fails to
 * detect (returns 0 masks) are omitted from the result — caller falls back
 * to whatever geometry it already has.
 *
 * @param imageBuffer  The room photo as a Buffer (JPEG/PNG).
 * @param types        Surface types to segment, e.g. ["wall", "floor", "ceiling"].
 * @param falApiKey    fal.ai API key.
 */
export async function segmentRoomSurfaces(
    imageBuffer: Buffer,
    types: string[],
    falApiKey: string
): Promise<Map<string, SegmentationMask>> {
    if (!falApiKey) {
        throw new Error("fal.ai API key required for SAM 3 segmentation");
    }

    const dataUri = `data:image/jpeg;base64,${imageBuffer.toString("base64")}`;

    // Fire all SAM 3 calls in parallel.
    const results = await Promise.all(
        types.map(async (type) => {
            try {
                const mask = await callSam3(dataUri, type, falApiKey);
                return [type, mask] as const;
            } catch (e: any) {
                console.warn(`[SAM3] segmentation for "${type}" failed: ${e?.message}`);
                return [type, null] as const;
            }
        })
    );

    const map = new Map<string, SegmentationMask>();
    for (const [type, mask] of results) {
        if (mask) map.set(type, mask);
    }
    return map;
}

/**
 * Single SAM 3 call. Sends the image + text prompt, receives a hosted mask
 * URL, downloads it, extracts the alpha channel as a 1-channel buffer.
 */
async function callSam3(
    imageDataUri: string,
    prompt: string,
    falApiKey: string
): Promise<SegmentationMask | null> {
    const body = JSON.stringify({ image_url: imageDataUri, prompt });

    const response = await fetch(SAM3_ENDPOINT, {
        method: "POST",
        headers: {
            "Authorization": `Key ${falApiKey}`,
            "Content-Type": "application/json",
        },
        body,
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`SAM 3 HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = await response.json() as any;
    const masks = data?.masks;
    if (!Array.isArray(masks) || masks.length === 0) {
        // SAM 3 sometimes returns 0 masks for prompts it doesn't recognize
        // (e.g. "picture frame", "lamp" in our tests). This is not an error —
        // the caller just doesn't get a mask for that type.
        return null;
    }

    const maskUrl = masks[0]?.url;
    if (!maskUrl) return null;

    // Download the mask PNG
    const maskResp = await fetch(maskUrl);
    if (!maskResp.ok) {
        throw new Error(`SAM 3 mask download failed: ${maskResp.status}`);
    }
    const maskPng = Buffer.from(await maskResp.arrayBuffer());

    // Extract alpha channel (the actual segmentation signal)
    const meta = await sharp(maskPng).metadata();
    const width = meta.width || 0;
    const height = meta.height || 0;
    if (width === 0 || height === 0) {
        throw new Error("SAM 3 mask has zero dimensions");
    }

    // Get just the alpha channel as a raw buffer
    const alphaBuffer = await sharp(maskPng)
        .extractChannel(3) // alpha
        .raw()
        .toBuffer();

    // Count opaque pixels for the sanity metric
    let opaque = 0;
    for (let i = 0; i < alphaBuffer.length; i++) {
        if (alphaBuffer[i] > 127) opaque++;
    }
    const opaquePercent = (opaque / alphaBuffer.length) * 100;

    console.log(`[SAM3] "${prompt}": ${width}x${height}, ${opaquePercent.toFixed(1)}% opaque`);

    // Sanity: reject degenerate masks (>95% means SAM 3 segmented almost the
    // entire image, which is useless; <0.5% is likely noise)
    if (opaquePercent > 95 || opaquePercent < 0.1) {
        console.warn(`[SAM3] "${prompt}": degenerate mask (${opaquePercent.toFixed(1)}%), discarding`);
        return null;
    }

    return { type: prompt, alphaBuffer, width, height, opaquePercent };
}

/**
 * Combine a wall mask (from SAM 3) with obstacle masks into a single binary
 * inpaint mask. Walls = edit (255), everything else = preserve (0).
 *
 * This is the FLUX-compatible mask format (white=fill, black=keep) at the
 * full resolution of the room photo. Obstacle alphas are subtracted from
 * the wall region so furniture inside the wall plane gets preserved.
 *
 * @param wallAlpha   1-channel alpha from SAM 3 "wall" prompt
 * @param maskW       width of the SAM 3 mask (= room photo width)
 * @param maskH       height of the SAM 3 mask (= room photo height)
 * @param obstacleAlphas  array of { type, alphaBuffer } for furniture/TV/etc.
 */
export function buildBinaryMaskFromAlphas(
    wallAlpha: Buffer,
    maskW: number,
    maskH: number,
    obstacleAlphas: Array<{ type: string; alphaBuffer: Buffer }> = []
): Buffer {
    // Start from the wall mask (255 = wall, 0 = not wall)
    const out = Buffer.from(wallAlpha);

    // Subtract obstacles: anywhere an obstacle is opaque, force the wall
    // mask to 0 (preserve) so FLUX doesn't paint over furniture.
    for (const obs of obstacleAlphas) {
        if (obs.alphaBuffer.length !== out.length) {
            console.warn(`[Mask] obstacle "${obs.type}" alpha size mismatch (${obs.alphaBuffer.length} vs ${out.length}), skipping`);
            continue;
        }
        for (let i = 0; i < out.length; i++) {
            if (obs.alphaBuffer[i] > 127) out[i] = 0;
        }
    }

    // Threshold: anything >127 in the wall mask becomes 255 (clean white),
    // anything else becomes 0 (clean black). FLUX prefers hard binary masks.
    for (let i = 0; i < out.length; i++) {
        out[i] = out[i] > 127 ? 255 : 0;
    }

    return out;
}

/**
 * Convert a 1-channel binary mask (0/255) to a PNG buffer suitable for
 * sending to FLUX Fill. Single-channel grayscale PNG.
 */
export async function binaryMaskToPng(mask: Buffer, width: number, height: number): Promise<Buffer> {
    return sharp(mask, {
        raw: { width, height, channels: 1 }
    }).png().toBuffer();
}
