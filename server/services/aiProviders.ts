// =============================================================
// Multi-Provider AI Abstraction Layer
// Routes AI calls to Gemini or OpenAI based on config.
// All provider-specific logic lives here — zero leakage to endpoints.
// =============================================================

import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import fs from "fs";
import path from "path";

// ---- Types ----

export type AIProvider = "gemini" | "openai";

export interface AIConfig {
    AI_PROVIDER: AIProvider;
    GEMINI_API_KEY: string;
    OPENAI_API_KEY: string;
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
}

export interface OverlayRequest {
    originalImage: string;
    material: {
        id?: string;
        refCode?: string;
        name?: string;
        category?: string;
        subcategory?: string;
        imageUrl?: string;
        promptModifier?: string;
        usage?: string;
    };
    userInstruction: string;
    renderOptions?: {
        lighting?: "SUNSET" | "NIGHT_LUXURY" | "NATURAL";
    };
}

export interface AnalysisRequest {
    image: string;
    lang?: string;
}

// ---- Helpers ----

// CJS-safe: always use __dirname (esbuild bundles to CJS)
const SERVER_DIR = typeof __dirname !== "undefined" ? __dirname : path.resolve();

const cleanBase64 = (dataURI: string) =>
    dataURI.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");

const getMimeType = (dataURI: string) => {
    const match = dataURI.match(/^data:(image\/\w+);base64,/);
    return match ? match[1] : "image/jpeg";
};

const getImageBase64 = async (urlPath: string): Promise<{ data: string; mimeType: string } | null> => {
    try {
        if (!urlPath) return null;
        if (urlPath.startsWith("http://") || urlPath.startsWith("https://")) {
            const response = await fetch(urlPath);
            if (!response.ok) return null;
            const buffer = Buffer.from(await response.arrayBuffer());
            const mimeType = response.headers.get("content-type") || "image/jpeg";
            return { data: buffer.toString("base64"), mimeType };
        }
        const cleanPath = urlPath.startsWith("/") ? urlPath.substring(1) : urlPath;
        const possiblePaths = [
            path.join(process.cwd(), "public", cleanPath),
            path.join(process.cwd(), cleanPath),
            path.resolve(cleanPath),
        ];
        for (const fullPath of possiblePaths) {
            if (fs.existsSync(fullPath)) {
                const data = fs.readFileSync(fullPath);
                const ext = path.extname(fullPath).toLowerCase().replace(".", "");
                const mimeType = ext === "webp" ? "image/webp" : ext === "png" ? "image/png" : "image/jpeg";
                return { data: data.toString("base64"), mimeType };
            }
        }
        return null;
    } catch {
        return null;
    }
};

// ---- Config Resolution ----

const JSON_CONFIG_PATHS = [
    path.join(process.cwd(), "data", "config.json"),
    path.resolve(SERVER_DIR, "..", "..", "data", "config.json"),
    path.resolve(SERVER_DIR, "..", "..", "..", "data", "config.json"),
];

function findConfigPath(): string | null {
    for (const p of JSON_CONFIG_PATHS) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

/** Read /data/config.json and merge with env vars. Env vars take priority. */
export function loadConfig(): AIConfig {
    const defaults: AIConfig = {
        AI_PROVIDER: "gemini",
        GEMINI_API_KEY: process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || "",
        OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
    };

    const configPath = findConfigPath();
    if (configPath) {
        try {
            const file = JSON.parse(fs.readFileSync(configPath, "utf8"));
            return {
                AI_PROVIDER: file.AI_PROVIDER || defaults.AI_PROVIDER,
                GEMINI_API_KEY: file.GEMINI_API_KEY || defaults.GEMINI_API_KEY,
                OPENAI_API_KEY: file.OPENAI_API_KEY || defaults.OPENAI_API_KEY,
                STRIPE_SECRET_KEY: file.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY || "",
                STRIPE_WEBHOOK_SECRET: file.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET || "",
            };
        } catch { /* fall through */ }
    }
    return {
        ...defaults,
        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "",
        STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || "",
    };
}

// ---- Lazy SDK instances (cached by key) ----

let _cachedGeminiKey = "";
let _cachedGemini: GoogleGenAI | null = null;
let _cachedOpenAIKey = "";
let _cachedOpenAI: OpenAI | null = null;

function getGeminiSDK(apiKey: string): GoogleGenAI {
    if (_cachedGemini && _cachedGeminiKey === apiKey) return _cachedGemini;
    _cachedGemini = new GoogleGenAI({ apiKey });
    _cachedGeminiKey = apiKey;
    return _cachedGemini;
}

function getOpenAISDK(apiKey: string): OpenAI {
    if (_cachedOpenAI && _cachedOpenAIKey === apiKey) return _cachedOpenAI;
    _cachedOpenAI = new OpenAI({ apiKey });
    _cachedOpenAIKey = apiKey;
    return _cachedOpenAI;
}

// ---- Image extraction helpers ----

function extractGeminiImage(response: any): string {
    if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
                return `data:image/png;base64,${part.inlineData.data}`;
            }
        }
    }
    throw new Error("No image generated in Gemini response.");
}

function extractOpenAIImage(response: OpenAI.Images.ImageGenerateParams & { data: any[] }): string {
    // GPT-4o with image output returns base64 in response
    if (typeof response === "string") return response;
    if ((response as any).data?.[0]?.b64_json) {
        return `data:image/png;base64,${(response as any).data[0].b64_json}`;
    }
    if ((response as any).data?.[0]?.url) {
        return (response as any).data[0].url;
    }
    throw new Error("No image returned from OpenAI.");
}

// =============================================================
// IMAGE GENERATION (Overlay)
// =============================================================

export async function generateOverlay(
    req: OverlayRequest,
    provider: AIProvider,
    config: AIConfig
): Promise<{ image: string; model: string; durationMs: number }> {
    const start = Date.now();

    if (provider === "openai") {
        return generateOverlayOpenAI(req, config);
    }

    // Default: Gemini
    return generateOverlayGemini(req, config, () => Date.now() - start);
}

async function generateOverlayGemini(
    req: OverlayRequest,
    config: AIConfig,
    elapsed: () => number
): Promise<{ image: string; model: string; durationMs: number }> {
    const ai = getGeminiSDK(config.GEMINI_API_KEY);
    const base64Data = cleanBase64(req.originalImage);
    const mimeType = getMimeType(req.originalImage);

    const isFurniture = req.material?.category === "Muebles" || req.material?.usage === "Furniture";

    const lightingHint =
        req.renderOptions?.lighting === "SUNSET"
            ? "warm golden hour sunset lighting"
            : req.renderOptions?.lighting === "NIGHT_LUXURY"
                ? "dramatic night luxury lighting with warm interior glow"
                : "natural ambient lighting";

    const productRef = await getImageBase64(req.material?.imageUrl);
    const hasProductImage = !!productRef;

    const materialIdentity = `"${req.material?.name || "selected material"}" — Category: ${req.material?.category || "general"}${req.material?.subcategory ? `, Sub: ${req.material.subcategory}` : ""}`;

    let finalPrompt: string;
    if (isFurniture) {
        finalPrompt = `You are a professional virtual stager.
Place the product shown in the "Product Reference" image into this room.
Product Name: ${materialIdentity}
Style: ${req.material?.promptModifier || "modern"}.
${req.userInstruction ? `User request: "${req.userInstruction}"` : ""}
Rules:
- Match room perspective, scale to surrounding objects
- Cast correct shadows from the room's light source (${lightingHint})
- Use exact textures/colors from the Product Reference image
- Do NOT alter existing furniture/objects unless user asks
- Output ONLY the final image`;
    } else {
        finalPrompt = `You are an elite architectural visualization specialist.
Your task is to photorealistically OVERLAY the material from the "Product Reference" image onto the appropriate surfaces in the user's original room photo.
Material: ${materialIdentity}
${req.userInstruction ? `User request: "${req.userInstruction}"` : ""}

STRICT RENDERING RULES:
1. 100% PHOTOREALISM: The output must look like a real photograph, equal in quality and resolution to the original picture.
2. EXACT OVERLAY: Apply the EXACT texture, pattern, color, and scale from the Product Reference image onto the target surface.
3. PRESERVE FOREGROUND: You MUST flawlessly preserve and cut around all objects IN FRONT of the surface (furniture, people, plants, windows). DO NOT paint over them.
4. PERSPECTIVE & LIGHTING: Match the room's 3D perspective exactly. Re-apply the original room's shadows, reflections, and highlights over the new material so it blends perfectly.
5. Lighting conditions: ${lightingHint}
6. Output ONLY the final high-quality image.`;
    }

    const contents: any = {
        parts: [{ inlineData: { data: base64Data, mimeType } }],
    };
    if (hasProductImage) {
        contents.parts.push({ text: "Product Reference Image:" });
        contents.parts.push({ inlineData: { data: productRef!.data, mimeType: productRef!.mimeType } });
    }
    contents.parts.push({ text: finalPrompt });

    let usedModel = "gemini-2.5-flash-image";
    let response;
    try {
        response = await ai.models.generateContent({
            model: "gemini-2.5-flash-image",
            contents,
            config: { responseModalities: ["TEXT", "IMAGE"] },
        });
    } catch (primaryError) {
        console.warn("gemini-2.5-flash-image failed, trying gemini-2.5-flash:", primaryError);
        usedModel = "gemini-2.5-flash";
        response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents,
            config: { responseModalities: ["TEXT", "IMAGE"] },
        });
    }

    const image = extractGeminiImage(response);
    return { image, model: usedModel, durationMs: elapsed() };
}

async function generateOverlayOpenAI(
    req: OverlayRequest,
    config: AIConfig
): Promise<{ image: string; model: string; durationMs: number }> {
    const start = Date.now();
    const ai = getOpenAISDK(config.OPENAI_API_KEY);
    const base64Data = cleanBase64(req.originalImage);
    const mimeType = getMimeType(req.originalImage);

    const isFurniture = req.material?.category === "Muebles" || req.material?.usage === "Furniture";

    const lightingHint =
        req.renderOptions?.lighting === "SUNSET"
            ? "warm golden hour sunset lighting"
            : req.renderOptions?.lighting === "NIGHT_LUXURY"
                ? "dramatic night luxury lighting with warm interior glow"
                : "natural ambient lighting";

    const productRef = await getImageBase64(req.material?.imageUrl);
    const materialIdentity = `"${req.material?.name || "selected material"}" — Category: ${req.material?.category || "general"}${req.material?.subcategory ? `, Sub: ${req.material.subcategory}` : ""}`;

    let instruction: string;
    if (isFurniture) {
        instruction = `Place the product "${materialIdentity}" into this room photo.
Match room perspective, scale to surrounding objects.
Cast correct shadows (${lightingHint}).
Do NOT alter existing furniture/objects unless asked.`;
    } else {
        instruction = `Photorealistically OVERLAY the material "${materialIdentity}" onto the appropriate surfaces in this room photo.
Apply EXACT texture, pattern, color, and scale.
Preserve all foreground objects (furniture, people, plants, windows) — do NOT paint over them.
Match the room's 3D perspective and lighting (${lightingHint}).`;
    }
    if (req.userInstruction) instruction += `\nUser request: "${req.userInstruction}"`;

    // Build message content with room image + optional product reference
    const userContent: OpenAI.Chat.ChatCompletionContentPart[] = [
        {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${base64Data}`, detail: "high" },
        },
    ];

    if (productRef) {
        userContent.push({
            type: "image_url",
            image_url: { url: `data:${productRef.mimeType};base64,${productRef.data}`, detail: "high" },
        });
        userContent.push({ type: "text", text: "↑ Product Reference — apply this exact material" });
    }

    userContent.push({ type: "text", text: instruction });

    const model = "gpt-4o";
    const completion = await ai.chat.completions.create({
        model,
        messages: [
            {
                role: "system",
                content:
                    "You are an elite architectural visualization AI. Output ONLY the final rendered image. Never describe what you did — just produce the image.",
            },
            { role: "user", content: userContent as any },
        ],
        max_tokens: 4096,
    });

    // GPT-4o can return image via tool or inline — for now, check for image in response
    // If GPT-4o doesn't output image natively, fall back to DALL-E
    const text = completion.choices[0]?.message?.content || "";

    // Check if response contains a base64 image or URL
    if (text.startsWith("data:image") || text.startsWith("http")) {
        return { image: text, model, durationMs: Date.now() - start };
    }

    // Fallback: Use DALL-E 3 for pure image generation
    console.log("GPT-4o returned text-only, falling back to DALL-E 3");
    const dalleResp = await ai.images.generate({
        model: "dall-e-3",
        prompt: `Photorealistic architectural visualization: ${req.material?.name || ""} applied to a room. ${instruction.substring(0, 900)}`,
        n: 1,
        size: "1024x1024",
        quality: "hd",
        response_format: "b64_json",
    });

    const dallEImage = (dalleResp as any).data?.[0]?.b64_json
        ? `data:image/png;base64,${(dalleResp as any).data[0].b64_json}`
        : (dalleResp as any).data?.[0]?.url || "";

    if (!dallEImage) throw new Error("No image returned from OpenAI.");
    return { image: dallEImage, model: "dall-e-3", durationMs: Date.now() - start };
}

// =============================================================
// ROOM ANALYSIS (Text)
// =============================================================

export async function analyzeRoom(
    req: AnalysisRequest,
    provider: AIProvider,
    config: AIConfig
): Promise<{ analysis: string; model: string; durationMs: number }> {
    const start = Date.now();

    if (provider === "openai") {
        return analyzeRoomOpenAI(req, config);
    }

    return analyzeRoomGemini(req, config, () => Date.now() - start);
}

async function analyzeRoomGemini(
    req: AnalysisRequest,
    config: AIConfig,
    elapsed: () => number
): Promise<{ analysis: string; model: string; durationMs: number }> {
    const ai = getGeminiSDK(config.GEMINI_API_KEY);
    const base64Data = cleanBase64(req.image);
    const mimeType = getMimeType(req.image);

    const model = "gemini-2.5-flash";
    const response = await ai.models.generateContent({
        model,
        contents: {
            parts: [
                { inlineData: { data: base64Data, mimeType } },
                {
                    text: "Analyze this interior/exterior space as a Senior Architect. 1) Identify the Design Style. 2) Analyze lighting. 3) Suggest ideal materials. Keep it brief and professional (max 100 words).",
                },
            ],
        },
    });

    return { analysis: response.text || "Could not analyze the room.", model, durationMs: elapsed() };
}

async function analyzeRoomOpenAI(
    req: AnalysisRequest,
    config: AIConfig
): Promise<{ analysis: string; model: string; durationMs: number }> {
    const start = Date.now();
    const ai = getOpenAISDK(config.OPENAI_API_KEY);
    const mimeType = getMimeType(req.image);
    const base64Data = cleanBase64(req.image);

    const model = "gpt-4o-mini";
    const completion = await ai.chat.completions.create({
        model,
        messages: [
            {
                role: "user",
                content: [
                    {
                        type: "image_url",
                        image_url: { url: `data:${mimeType};base64,${base64Data}`, detail: "low" },
                    },
                    {
                        type: "text",
                        text: "Analyze this interior/exterior space as a Senior Architect. 1) Identify the Design Style. 2) Analyze lighting. 3) Suggest ideal materials. Keep it brief and professional (max 100 words).",
                    },
                ],
            },
        ],
        max_tokens: 300,
    });

    const analysis = completion.choices[0]?.message?.content || "Could not analyze the room.";
    return { analysis, model, durationMs: Date.now() - start };
}

// =============================================================
// PROVIDER HEALTH CHECK
// =============================================================

export async function checkProviderHealth(
    provider: AIProvider,
    apiKey: string
): Promise<{ ok: boolean; message: string }> {
    if (!apiKey) {
        return { ok: false, message: `No API key configured for ${provider}` };
    }
    try {
        if (provider === "openai") {
            const ai = getOpenAISDK(apiKey);
            await ai.models.list();
            return { ok: true, message: "OpenAI API key valid" };
        }
        // Gemini quick check — just verify the SDK can initialize
        const ai = getGeminiSDK(apiKey);
        await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: { parts: [{ text: "ping" }] },
        });
        return { ok: true, message: "Gemini API key valid" };
    } catch (e: any) {
        return { ok: false, message: e.message || `${provider} check failed` };
    }
}
