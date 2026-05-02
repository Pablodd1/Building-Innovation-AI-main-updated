
import { GoogleGenAI } from "@google/genai";
import { Material, RenderOptions } from "../types";

// --- Utility Helpers ---

const cleanBase64 = (dataURI: string) =>
    dataURI.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");

const getMimeType = (dataURI: string) => {
    const match = dataURI.match(/^data:(image\/\w+);base64,/);
    return match ? match[1] : "image/jpeg";
};

const getErrorMessage = (error: any): string => {
    if (typeof error === "string") return error;
    if (error?.error?.message) return error.error.message;
    if (error?.response?.data?.error?.message)
        return error.response.data.error.message;
    if (error?.message) return error.message;
    return JSON.stringify(error);
};

const extractImage = (response: any): string => {
    if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
                return `data:image/png;base64,${part.inlineData.data}`;
            }
        }
    }
    throw new Error("No image generated in the response.");
};

const getApiKey = (): string => {
    const customKey = localStorage.getItem("custom_api_key");
    if (customKey?.trim().length) return customKey.trim();
    if (process.env.API_KEY || process.env.VITE_GEMINI_API_KEY) return process.env.API_KEY || process.env.VITE_GEMINI_API_KEY!;
    return ""; // Will be handled by the backend if we proxy, or fail here if local
};

const checkQuota = async (userId: number, type: string) => {
    try {
        const res = await fetch("/api/ai/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId, type })
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.message || err.error || "Quota exceeded");
        }
        return await res.json();
    } catch (e: any) {
        throw e;
    }
};

// --- Room Analysis (text-only, already fast) ---

export const generateRoomAnalysis = async (
    imageBase64: string,
    userId?: number,
    lang: string = "en"
): Promise<string> => {
    if (userId) await checkQuota(userId, "analysis");
    const apiKey = getApiKey();
    const ai = new GoogleGenAI({ apiKey });
    const base64Data = cleanBase64(imageBase64);
    const mimeType = getMimeType(imageBase64);

    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: {
            parts: [
                { inlineData: { data: base64Data, mimeType } },
                {
                    text: "Analyze this interior/exterior space as a Senior Architect. 1) Identify the Design Style. 2) Analyze lighting. 3) Suggest ideal materials. Keep it brief and professional (max 100 words).",
                },
            ],
        },
    });

    return response.text || "Could not analyze the room.";
};

// --- Video Generation (unchanged, already async w/ polling) ---

export const generateCinematicVideo = async (
    imageBase64: string,
    prompt: string,
    userId?: number
): Promise<string | null> => {
    if (userId) await checkQuota(userId, "video");
    const apiKey = getApiKey();
    const ai = new GoogleGenAI({ apiKey });
    const base64Data = cleanBase64(imageBase64);
    const mimeType = getMimeType(imageBase64);

    const generateWithModel = async (modelName: string) => {
        let operation = await ai.models.generateVideos({
            model: modelName,
            image: { imageBytes: base64Data, mimeType },
            prompt: `Cinematic slow pan showing this room, ${prompt}, 4k architectural visualization`,
            config: {
                numberOfVideos: 1,
                resolution: "720p",
                aspectRatio: "16:9",
            },
        });
        while (!operation.done) {
            await new Promise((resolve) => setTimeout(resolve, 5000));
            operation = await ai.operations.getVideosOperation({
                operation,
            });
        }
        return operation.response?.generatedVideos?.[0]?.video?.uri;
    };

    try {
        return await generateWithModel("veo-3.1-generate-preview");
    } catch {
        try {
            return await generateWithModel("veo-3.1-fast-generate-preview");
        } catch (fallbackError: any) {
            console.warn("Veo Video Generation unavailable:", getErrorMessage(fallbackError));
            return null;
        }
    }
};

// --- Stub for generateMaterialProbe (imported but unused) ---

export const generateMaterialProbe = async (): Promise<string | null> => {
    return null;
};

// =============================================================
// SPEED-OPTIMIZED Material Overlay Generation
// =============================================================

export const generateMaterialOverlay = async (
    originalImageBase64: string,
    material: Material,
    userInstruction: string,
    renderOptions?: RenderOptions,
    lang?: string,
    userId?: number
): Promise<string> => {
    if (userId) await checkQuota(userId, "overlay");
    const apiKey = getApiKey();
    const ai = new GoogleGenAI({ apiKey });

    const base64Data = cleanBase64(originalImageBase64);
    const mimeType = getMimeType(originalImageBase64);

    const isFurniture =
        material.usage === "Furniture" || material.category === "Muebles";

    // Lighting context from renderOptions (optional)
    const lightingHint =
        renderOptions?.lighting === "SUNSET"
            ? "warm golden hour sunset lighting"
            : renderOptions?.lighting === "NIGHT_LUXURY"
                ? "dramatic night luxury lighting with warm interior glow"
                : "natural ambient lighting";

    // ─── Try to fetch the material swatch image ───
    let materialSwatchPart: any = null;
    let hasSwatchImage = false;
    try {
        if (material.imageUrl) {
            let fetchUrl = material.imageUrl;
            if (fetchUrl.startsWith("/")) {
                fetchUrl = window.location.origin + fetchUrl;
            }
            const swatchRes = await fetch(fetchUrl);
            if (swatchRes.ok) {
                const swatchBlob = await swatchRes.blob();
                if (swatchBlob.size > 500 && swatchBlob.type.startsWith("image")) {
                    const swatchBase64 = await new Promise<string>((resolve) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result as string);
                        reader.readAsDataURL(swatchBlob);
                    });
                    const swatchData = cleanBase64(swatchBase64);
                    const swatchMime = swatchBlob.type || "image/jpeg";
                    materialSwatchPart = { inlineData: { data: swatchData, mimeType: swatchMime } };
                    hasSwatchImage = true;
                }
            }
        }
    } catch (e) {
        console.warn("Swatch image unavailable, using description fallback:", e);
    }

    // ─── Build prompt — adapts based on whether swatch image was loaded ───
    const materialIdentity = `"${material.name}" — Category: ${material.category}${material.subcategory ? `, Sub: ${material.subcategory}` : ""}`;
    const visualGuide = hasSwatchImage
        ? `Use the provided swatch image (second image) as the EXACT color, pattern, and texture reference.`
        : `VISUAL DESCRIPTION (no swatch image available — replicate this precisely):
${material.description}
Texture/pattern keywords: ${material.promptModifier || material.name}`;

    let finalPrompt: string;

    if (isFurniture) {
        finalPrompt = `You are a professional virtual stager.
Place ${materialIdentity} into this room.
Style: ${material.promptModifier || "modern"}.
${visualGuide}
${userInstruction ? `User request: "${userInstruction}"` : ""}

Rules:
- Match room perspective, scale to surrounding objects
- Cast correct shadows from the room's light source (${lightingHint})
- Photorealistic textures (fabric weave, wood grain, metal reflections)
- Do NOT alter existing furniture/objects unless user asks
- Output ONLY the final image`;
    } else {
        finalPrompt = `You are an architectural visualization specialist.
Apply ${materialIdentity} to the correct surfaces in this image.
${visualGuide}
${userInstruction ? `User request: "${userInstruction}"` : ""}

Rules:
- Apply material ONLY to matching surfaces (floors for flooring, walls for wall covering, ceilings for ceiling panels, etc.)
- Preserve all objects IN FRONT of the surface — do NOT paint over furniture, people, plants
- Match room perspective for texture mapping (grout lines, wood grain direction)
- Re-apply original shadows/highlights onto the new material
- Lighting: ${lightingHint}
- Output ONLY the final photorealistic image`;
    }

    const contents = {
        parts: [
            { inlineData: { data: base64Data, mimeType } },
            ...(hasSwatchImage ? [materialSwatchPart] : []),
            { text: finalPrompt },
        ],
    };

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-image",
            contents,
        });
        return extractImage(response);
    } catch (error: any) {
        console.warn(
            "Flash image generation failed, falling back to Pro model:",
            getErrorMessage(error)
        );

        try {
            const response = await ai.models.generateContent({
                model: "gemini-3-pro-image-preview",
                contents,
                config: {
                    imageConfig: {
                        imageSize: "1024x1024",
                    },
                },
            });
            return extractImage(response);
        } catch (fallbackError: any) {
            const msg = getErrorMessage(fallbackError);
            throw new Error(`Generation failed: ${msg}`);
        }
    }
};
