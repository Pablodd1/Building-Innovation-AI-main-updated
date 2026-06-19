// =============================================================
// Multi-Provider AI Abstraction Layer with Auto-Failover
// Routes AI calls across Gemini, OpenAI, OpenRouter, and local models
// All provider-specific logic lives here — zero leakage to endpoints.
//
// MODEL HISTORY (for reference when updating):
// ═══════════════════════════════════════════════════════════
// 2024-Q4: gemini-1.5-pro (deprecated 2025, returns 404)
// 2025-Q1: gemini-2.0-flash-exp (experimental, limited image support)
// 2025-Q2: gemini-2.0-flash-exp-image-generation (native image output)
// 2025-Q3: gemini-2.5-flash (stable, fast, good for analysis)
// 2025-Q4: gemini-2.5-flash-image (NEVER EXISTED — was a hallucination in old code)
// 2026-Q2: gemini-2.0-flash-exp-image-generation (CURRENT — primary image gen)
//          gemini-2.5-flash (CURRENT — primary analysis)
//
// BACKUP CHAIN (executed left-to-right on failure):
//   Gemini (primary) → OpenRouter (unified) → OpenAI (fallback) → Generic Response
// ═══════════════════════════════════════════════════════════
// =============================================================

import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import fs from "fs";
import path from "path";

// ---- Types ----

export type AIProvider = "gemini" | "openai" | "openrouter" | "generic";

export interface AIConfig {
    AI_PROVIDER: AIProvider;
    GEMINI_API_KEY: string;
    OPENAI_API_KEY: string;
    OPENROUTER_API_KEY: string;
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

export interface GenerationResult {
    image: string;
    model: string;
    durationMs: number;
    provider: AIProvider;
}

export interface AnalysisResult {
    analysis: string;
    dimensions?: RoomAnalysisDimensions;
    model: string;
    durationMs: number;
    provider: AIProvider;
}

export interface RoomAnalysisDimensions {
    width: number;   // in cm
    height: number;  // in cm
    areaM2: number;  // in square meters
}

// ---- Circuit Breaker Pattern ----
// Tracks provider failures to avoid hammering dead endpoints

interface CircuitState {
    failures: number;
    lastFailure: number;
    isOpen: boolean;
}

const circuitBreakers = new Map<string, CircuitState>();
const CIRCUIT_THRESHOLD = 5;      // Open after 5 HARD failures (raised from 3 to stop flapping)
const CIRCUIT_RESET_MS = 30000;  // Reset/half-open probe after 30s (was 60s)

function getCircuit(provider: string): CircuitState {
    if (!circuitBreakers.has(provider)) {
        circuitBreakers.set(provider, { failures: 0, lastFailure: 0, isOpen: false });
    }
    return circuitBreakers.get(provider)!;
}

/**
 * Classify an error as transient (rate limit / temporary server unavailability)
 * vs hard (auth, invalid key, malformed request). Transient errors should NOT
 * trip the circuit breaker — they're recoverable on the next request and
 * counting them causes the "carousel" flapping where Gemini briefly blacks out.
 */
function isTransientError(error: any): boolean {
    const msg = (error?.message || String(error || "")).toLowerCase();
    const status = error?.status || error?.code;
    return (
        status === 429 ||
        status === 503 ||
        status === 500 ||
        msg.includes("rate limit") ||
        msg.includes("resource_exhausted") ||
        msg.includes("quota") ||
        msg.includes("unavailable") ||
        msg.includes("overloaded") ||
        msg.includes("timeout") ||
        msg.includes("deadline")
    );
}

/**
 * @param provider provider name
 * @param error    the error that occurred — used to classify severity.
 *                 Transient errors (429/503/timeout) are NOT counted toward
 *                 opening the circuit, preventing flapping. Pass nothing to
 *                 force a hard count (back-compat).
 */
function recordFailure(provider: string, error?: any) {
    const circuit = getCircuit(provider);
    circuit.lastFailure = Date.now();

    // Transient errors don't trip the breaker — log and move on.
    if (error !== undefined && isTransientError(error)) {
        console.warn(`[CircuitBreaker] ${provider} transient error (not counted): ${error?.message || error}`);
        return;
    }

    circuit.failures++;
    if (circuit.failures >= CIRCUIT_THRESHOLD) {
        circuit.isOpen = true;
        console.warn(`[CircuitBreaker] ${provider} circuit OPENED after ${circuit.failures} hard failures`);
    }
}

function recordSuccess(provider: string) {
    const circuit = getCircuit(provider);
    circuit.failures = 0;
    circuit.isOpen = false;
}

function isCircuitOpen(provider: string): boolean {
    const circuit = getCircuit(provider);
    if (!circuit.isOpen) return false;
    // Check if enough time has passed to try again
    if (Date.now() - circuit.lastFailure > CIRCUIT_RESET_MS) {
        console.log(`[CircuitBreaker] ${provider} circuit reset after cooldown`);
        circuit.isOpen = false;
        circuit.failures = 0;
        return false;
    }
    return true;
}

// ---- Helpers ----

const SERVER_DIR = typeof __dirname !== "undefined" ? __dirname : path.resolve();

const cleanBase64 = (dataURI: string) =>
    dataURI.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");

const getMimeType = (dataURI: string) => {
    const match = dataURI.match(/^data:(image\/\w+);base64,/);
    return match ? match[1] : "image/jpeg";
};

const SELF_URL = process.env.SITE_URL || "https://buildingapp.us";

const getImageBase64 = async (urlPath: string): Promise<{ data: string; mimeType: string } | null> => {
    try {
        if (!urlPath) return null;
        if (urlPath.startsWith(SELF_URL + "/products/")) {
            const localRel = urlPath.substring(SELF_URL.length + 1);
            const localAbs = path.resolve(localRel);
            if (fs.existsSync(localAbs)) {
                const data = fs.readFileSync(localAbs);
                const ext = path.extname(localAbs).toLowerCase().replace(".", "");
                const mimeType = ext === "webp" ? "image/webp" : ext === "png" ? "image/png" : "image/jpeg";
                return { data: data.toString("base64"), mimeType };
            }
        }
        if (urlPath.startsWith("http://") || urlPath.startsWith("https://")) {
            if (urlPath.startsWith(SELF_URL)) {
                const localPath = urlPath.substring(SELF_URL.length);
                const cleanPath2 = localPath.startsWith("/") ? localPath.substring(1) : localPath;
                const possiblePaths = [
                    path.join(process.cwd(), cleanPath2),
                    path.resolve(cleanPath2),
                ];
                for (const p of possiblePaths) {
                    if (fs.existsSync(p)) {
                        const data = fs.readFileSync(p);
                        const ext = path.extname(p).toLowerCase().replace(".", "");
                        const mimeType = ext === "webp" ? "image/webp" : ext === "png" ? "image/png" : "image/jpeg";
                        return { data: data.toString("base64"), mimeType };
                    }
                }
                console.warn(`getImageBase64: local file not found for ${urlPath}`);
                return null;
            }
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
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || "",
    };

    const configPath = findConfigPath();
    if (configPath) {
        try {
            const file = JSON.parse(fs.readFileSync(configPath, "utf8"));
            return {
                AI_PROVIDER: file.AI_PROVIDER || defaults.AI_PROVIDER,
                GEMINI_API_KEY: file.GEMINI_API_KEY || defaults.GEMINI_API_KEY,
                OPENAI_API_KEY: file.OPENAI_API_KEY || defaults.OPENAI_API_KEY,
                OPENROUTER_API_KEY: file.OPENROUTER_API_KEY || defaults.OPENROUTER_API_KEY,
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

// ---- SDK instances (cached by key) ----

let _cachedGeminiKey = "";
let _cachedGemini: GoogleGenAI | null = null;
let _cachedOpenAIKey = "";
let _cachedOpenAI: OpenAI | null = null;
let _cachedOpenRouterKey = "";
let _cachedOpenRouter: OpenAI | null = null;

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

function getOpenRouterSDK(apiKey: string): OpenAI {
    if (_cachedOpenRouter && _cachedOpenRouterKey === apiKey) return _cachedOpenRouter;
    _cachedOpenRouter = new OpenAI({
        apiKey,
        baseURL: "https://openrouter.ai/api/v1",
    });
    _cachedOpenRouterKey = apiKey;
    return _cachedOpenRouter;
}

// ---- Extraction helpers ----

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

function extractOpenAIImage(response: any): string {
    if (typeof response === "string") return response;
    if (response.data?.[0]?.b64_json) {
        return `data:image/png;base64,${response.data[0].b64_json}`;
    }
    if (response.data?.[0]?.url) {
        return response.data[0].url;
    }
    throw new Error("No image returned from OpenAI.");
}

// =============================================================
// PROMPT BUILDERS (shared across providers)
// =============================================================

function buildOverlayPrompt(req: OverlayRequest): { prompt: string; isFurniture: boolean } {
    const isFurniture = req.material?.category === "Muebles" || req.material?.usage === "Furniture";
    
    const lightingHint =
        req.renderOptions?.lighting === "SUNSET"
            ? "warm golden hour sunset lighting"
            : req.renderOptions?.lighting === "NIGHT_LUXURY"
                ? "dramatic night luxury lighting with warm interior glow"
                : "natural ambient lighting";

    const materialIdentity = `"${req.material?.name || "selected material"}" — Category: ${req.material?.category || "general"}${req.material?.subcategory ? `, Sub: ${req.material.subcategory}` : ""}`;

    let prompt: string;
    if (isFurniture) {
        prompt = `You are a professional virtual stager.
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
        prompt = `You are an elite architectural visualization specialist.
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

    return { prompt, isFurniture };
}

const ANALYSIS_PROMPT = `Analyze this interior/exterior space as a Senior Architect.

Return your response in this EXACT JSON format:
{
  "text": "Brief professional analysis (max 80 words) covering: 1) Design Style, 2) Lighting, 3) Suggested materials.",
  "dimensions": {
    "width": 350,
    "height": 280,
    "areaM2": 9.8
  },
  "style": "Modern Minimalist",
  "lighting": "Natural daylight from large windows",
  "suggestedMaterials": ["Polished concrete", "White oak flooring"]
}

For dimensions: estimate the room's width and height in CENTIMETERS (e.g., 350 = 3.5m), and calculate areaM2 as (width * height) / 10000. Use typical room proportions if no reference objects are visible. Be realistic but do your best estimate.`;

function parseAnalysisResponse(rawText: string, model: string, provider: AIProvider, durationMs: number): AnalysisResult {
    try {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        const jsonStr = jsonMatch ? jsonMatch[0] : rawText;
        const parsed = JSON.parse(jsonStr);

        const text = parsed.text || "Could not analyze the room.";
        const dimensions = parsed.dimensions &&
            typeof parsed.dimensions.width === "number" &&
            typeof parsed.dimensions.height === "number" &&
            typeof parsed.dimensions.areaM2 === "number"
            ? parsed.dimensions
            : undefined;

        return { analysis: text, dimensions, model, provider, durationMs };
    } catch (e) {
        return { analysis: rawText, model, provider, durationMs };
    }
}

// =============================================================
// GENERIC FALLBACK — Always works, no API needed
// =============================================================

async function generateGenericOverlay(req: OverlayRequest): Promise<GenerationResult> {
    console.warn("[AI] All providers failed. Using generic fallback response.");
    
    // Return a simple "placeholder" image with text explaining the issue
    const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
        <rect fill="#1a1a2e" width="800" height="600"/>
        <text fill="#e94560" x="400" y="250" text-anchor="middle" font-family="Arial" font-size="24" font-weight="bold">AI Generation Temporarily Unavailable</text>
        <text fill="#eee" x="400" y="300" text-anchor="middle" font-family="Arial" font-size="16">We're experiencing high demand. Please try again in a moment.</text>
        <text fill="#888" x="400" y="350" text-anchor="middle" font-family="Arial" font-size="14">Material: ${req.material?.name || 'Unknown'}</text>
    </svg>`;
    
    const base64Svg = Buffer.from(svgContent).toString('base64');
    
    return {
        image: `data:image/svg+xml;base64,${base64Svg}`,
        model: "generic-fallback",
        durationMs: 0,
        provider: "generic"
    };
}

// =============================================================
// GEMINI PROVIDER — Primary (best image generation)
// =============================================================

async function generateOverlayGemini(req: OverlayRequest, config: AIConfig, startTime: number): Promise<GenerationResult> {
    if (isCircuitOpen("gemini")) {
        throw new Error("Gemini circuit breaker is open — skipping due to recent failures");
    }

    const ai = getGeminiSDK(config.GEMINI_API_KEY);
    const base64Data = cleanBase64(req.originalImage);
    const mimeType = getMimeType(req.originalImage);
    const { prompt: finalPrompt } = buildOverlayPrompt(req);
    const productRef = await getImageBase64(req.material?.imageUrl);
    const hasProductImage = !!productRef;

    const contents: any = {
        parts: [{ inlineData: { data: base64Data, mimeType } }],
    };
    if (hasProductImage) {
        contents.parts.push({ text: "Product Reference Image:" });
        contents.parts.push({ inlineData: { data: productRef!.data, mimeType: productRef!.mimeType } });
    }
    contents.parts.push({ text: finalPrompt });

    // ═══════════════════════════════════════════════════════════
    // GEMINI IMAGE MODEL FALLBACK CHAIN — Updated June 2026
    // Ordered by capability (best first)
    // ═══════════════════════════════════════════════════════════
    const IMAGE_MODELS = [
        // CORRECT (2026-06): The model with image generation is just "gemini-2.0-flash-exp"
        // The "-image-generation" suffix was NEVER a real model name — it was a hallucination.
        { name: "gemini-2.0-flash-exp", supportsImageOutput: true, note: "Primary — native image output" },
        // Stable fallback — text-only if image generation fails
        { name: "gemini-2.5-flash", supportsImageOutput: false, note: "Fallback — text only, no image gen" },
        // DEPRECATED MODELS (kept as comments for reference, DO NOT USE):
        // { name: "gemini-2.0-flash-exp-image-generation", supportsImageOutput: false, note: "NEVER EXISTED — hallucination" },
        // { name: "gemini-1.5-pro", supportsImageOutput: false, note: "DEPRECATED 2025 — returns 404" },
        // { name: "gemini-2.5-flash-image", supportsImageOutput: false, note: "NEVER EXISTED — hallucination" },
    ];

    let response;
    let usedModel = IMAGE_MODELS[0].name;
    let lastError: any = null;

    for (const modelInfo of IMAGE_MODELS) {
        try {
            console.log(`[AI] Trying Gemini model: ${modelInfo.name} (${modelInfo.note})...`);
            response = await ai.models.generateContent({
                model: modelInfo.name,
                contents,
                config: { responseModalities: ["TEXT", "IMAGE"] },
            });
            usedModel = modelInfo.name;
            console.log(`[AI] ✅ Gemini success with model: ${modelInfo.name}`);
            recordSuccess("gemini");
            break;
        } catch (error: any) {
            const msg = error?.message || String(error);
            const status = error?.status || error?.code;
            lastError = error;

            // Check if this is a model-not-found or invalid error
            const isModelError = msg.includes("not found") ||
                                msg.includes("not supported") ||
                                msg.includes("INVALID_ARGUMENT") ||
                                status === 404 ||
                                status === 400;

            const isLastModel = modelInfo === IMAGE_MODELS[IMAGE_MODELS.length - 1];

            if (isModelError && !isLastModel) {
                console.warn(`[AI] ⚠️ Gemini model ${modelInfo.name} failed (${msg}), trying next...`);
                continue;
            }

            // For rate limits on last model, retry once
            if ((status === 429 || status === 503 || msg.includes('UNAVAILABLE')) && isLastModel) {
                console.warn(`[AI] ⏳ Rate limited on ${modelInfo.name}, retrying after 2s...`);
                await new Promise(r => setTimeout(r, 2000));
                try {
                    response = await ai.models.generateContent({
                        model: modelInfo.name,
                        contents,
                        config: { responseModalities: ["TEXT", "IMAGE"] },
                    });
                    usedModel = modelInfo.name;
                    recordSuccess("gemini");
                    break;
                } catch (retryError) {
                    lastError = retryError;
                }
            }

            // Record failure for circuit breaker (transient 429/503 won't trip it)
            recordFailure("gemini", error);
            throw error;
        }
    }

    if (!response) {
        recordFailure("gemini", lastError);
        throw new Error(`All Gemini image models failed. Last error: ${lastError?.message || 'Unknown'}`);
    }

    const image = extractGeminiImage(response);
    return { image, model: usedModel, durationMs: Date.now() - startTime, provider: "gemini" };
}

async function analyzeRoomGemini(req: AnalysisRequest, config: AIConfig): Promise<AnalysisResult> {
    if (isCircuitOpen("gemini")) {
        throw new Error("Gemini circuit breaker is open");
    }

    const start = Date.now();
    const ai = getGeminiSDK(config.GEMINI_API_KEY);
    const base64Data = cleanBase64(req.image);
    const mimeType = getMimeType(req.image);

    // Analysis model fallback chain
    const ANALYSIS_MODELS = [
        { name: "gemini-2.5-flash", note: "Primary — stable and fast" },
        { name: "gemini-2.0-flash-exp", note: "Fallback — experimental" },
    ];

    let lastError: any = null;

    for (const modelInfo of ANALYSIS_MODELS) {
        try {
            const response = await ai.models.generateContent({
                model: modelInfo.name,
                contents: {
                    parts: [
                        { inlineData: { data: base64Data, mimeType } },
                        { text: ANALYSIS_PROMPT },
                    ],
                },
            });

            const rawText = response.text || "{\"text\":\"Could not analyze the room.\"}";
            recordSuccess("gemini");
            return parseAnalysisResponse(rawText, modelInfo.name, "gemini", Date.now() - start);
        } catch (error: any) {
            lastError = error;
            const msg = error?.message || String(error);
            const isLast = modelInfo === ANALYSIS_MODELS[ANALYSIS_MODELS.length - 1];
            
            if ((msg.includes("not found") || msg.includes("not supported")) && !isLast) {
                console.warn(`[AI] ⚠️ Analysis model ${modelInfo.name} failed, trying next...`);
                continue;
            }
            
            recordFailure("gemini", error);
            if (isLast) throw error;
        }
    }

    throw lastError || new Error("All Gemini analysis models failed");
}

// =============================================================
// OPENROUTER PROVIDER — Unified API (Gemini + OpenAI + Claude)
// Sign up: https://openrouter.ai/ (free, instant)
// =============================================================

async function generateOverlayOpenRouter(req: OverlayRequest, config: AIConfig, startTime: number): Promise<GenerationResult> {
    if (!config.OPENROUTER_API_KEY) {
        throw new Error("OpenRouter API key not configured");
    }
    if (isCircuitOpen("openrouter")) {
        throw new Error("OpenRouter circuit breaker is open");
    }

    const ai = getOpenRouterSDK(config.OPENROUTER_API_KEY);
    const base64Data = cleanBase64(req.originalImage);
    const { prompt: finalPrompt } = buildOverlayPrompt(req);

    // OpenRouter model fallback chain for image generation
    const OR_IMAGE_MODELS = [
        "google/gemini-2.0-flash-exp:free",     // Free tier available
        "google/gemini-2.5-flash",              // Standard tier
        "anthropic/claude-3.5-sonnet",          // No image output, text fallback
    ];

    let lastError: any = null;

    for (const modelName of OR_IMAGE_MODELS) {
        try {
            console.log(`[AI] Trying OpenRouter model: ${modelName}...`);
            
            // Note: Most models on OpenRouter don't support native image output
            // This is a best-effort fallback that returns text descriptions
            const response = await ai.chat.completions.create({
                model: modelName,
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Data}` } },
                            { type: "text", text: finalPrompt + "\n\nIMPORTANT: Return a detailed text description of what the final image would look like." },
                        ],
                    },
                ],
                max_tokens: 1000,
            });

            const text = response.choices[0]?.message?.content || "Image generation unavailable";
            
            // Create a placeholder with the description
            const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
                <rect fill="#f0f0f0" width="800" height="600"/>
                <text fill="#333" x="400" y="280" text-anchor="middle" font-family="Arial" font-size="18" font-weight="bold">AI Visualization Preview</text>
                <text fill="#666" x="400" y="320" text-anchor="middle" font-family="Arial" font-size="14">${text.substring(0, 200).replace(/"/g, '&quot;')}...</text>
                <text fill="#999" x="400" y="360" text-anchor="middle" font-family="Arial" font-size="12">Model: ${modelName}</text>
            </svg>`;
            
            const base64Svg = Buffer.from(svgContent).toString('base64');
            
            console.log(`[AI] ✅ OpenRouter success with model: ${modelName}`);
            recordSuccess("openrouter");
            return {
                image: `data:image/svg+xml;base64,${base64Svg}`,
                model: modelName,
                durationMs: Date.now() - startTime,
                provider: "openrouter"
            };
        } catch (error: any) {
            lastError = error;
            console.warn(`[AI] ⚠️ OpenRouter model ${modelName} failed: ${error.message}`);
        }
    }

    recordFailure("openrouter", lastError);
    throw lastError || new Error("All OpenRouter models failed");
}

async function analyzeRoomOpenRouter(req: AnalysisRequest, config: AIConfig): Promise<AnalysisResult> {
    if (!config.OPENROUTER_API_KEY) {
        throw new Error("OpenRouter API key not configured");
    }
    if (isCircuitOpen("openrouter")) {
        throw new Error("OpenRouter circuit breaker is open");
    }

    const start = Date.now();
    const ai = getOpenRouterSDK(config.OPENROUTER_API_KEY);
    const base64Data = cleanBase64(req.image);
    const mimeType = getMimeType(req.image);

    const OR_ANALYSIS_MODELS = [
        "google/gemini-2.5-flash",
        "openai/gpt-4o-mini",
        "anthropic/claude-3.5-sonnet",
    ];

    let lastError: any = null;

    for (const modelName of OR_ANALYSIS_MODELS) {
        try {
            const response = await ai.chat.completions.create({
                model: modelName,
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Data}` } },
                            { type: "text", text: ANALYSIS_PROMPT },
                        ],
                    },
                ],
                max_tokens: 500,
            });

            const rawText = response.choices[0]?.message?.content || "{\"text\":\"Could not analyze.\"}";
            recordSuccess("openrouter");
            return parseAnalysisResponse(rawText, modelName, "openrouter", Date.now() - start);
        } catch (error: any) {
            lastError = error;
            console.warn(`[AI] ⚠️ OpenRouter analysis model ${modelName} failed: ${error.message}`);
        }
    }

    recordFailure("openrouter", lastError);
    throw lastError || new Error("All OpenRouter analysis models failed");
}

// =============================================================
// OPENAI PROVIDER — Fallback (text analysis only)
// Note: OpenAI Chat API doesn't support image output natively
// =============================================================

async function analyzeRoomOpenAI(req: AnalysisRequest, config: AIConfig): Promise<AnalysisResult> {
    if (!config.OPENAI_API_KEY) {
        throw new Error("OpenAI API key not configured");
    }
    if (isCircuitOpen("openai")) {
        throw new Error("OpenAI circuit breaker is open");
    }

    const start = Date.now();
    const ai = getOpenAISDK(config.OPENAI_API_KEY);
    const mimeType = getMimeType(req.image);
    const base64Data = cleanBase64(req.image);

    try {
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
                        { type: "text", text: ANALYSIS_PROMPT },
                    ],
                },
            ],
            max_tokens: 500,
        });

        const rawText = completion.choices[0]?.message?.content || "{\"text\":\"Could not analyze.\"}";
        recordSuccess("openai");
        return parseAnalysisResponse(rawText, model, "openai", Date.now() - start);
    } catch (error: any) {
        recordFailure("openai", error);
        throw error;
    }
}

// =============================================================
// PUBLIC API — Multi-Provider Failover Orchestrator
// =============================================================

export async function generateOverlay(
    req: OverlayRequest,
    preferredProvider: AIProvider,
    config: AIConfig
): Promise<GenerationResult> {
    const start = Date.now();
    const errors: string[] = [];

    // Provider priority chain for IMAGE GENERATION
    // Gemini is best (native image output), OpenRouter is second (unified), generic is last
    const providerChain: AIProvider[] = [preferredProvider, "openrouter", "generic"]
        .filter((p, i, arr) => arr.indexOf(p) === i); // dedupe

    console.log(`[AI] Starting image generation with provider chain: ${providerChain.join(" → ")}`);

    for (const provider of providerChain) {
        try {
            switch (provider) {
                case "gemini":
                    if (!config.GEMINI_API_KEY) {
                        errors.push("Gemini: No API key configured");
                        continue;
                    }
                    return await generateOverlayGemini(req, config, start);

                case "openrouter":
                    if (!config.OPENROUTER_API_KEY) {
                        errors.push("OpenRouter: No API key configured");
                        continue;
                    }
                    return await generateOverlayOpenRouter(req, config, start);

                case "generic":
                    return await generateGenericOverlay(req);

                case "openai":
                    errors.push("OpenAI: Chat API does not support image output");
                    continue;

                default:
                    errors.push(`${provider}: Unknown provider`);
            }
        } catch (error: any) {
            const msg = error?.message || String(error);
            console.error(`[AI] ❌ Provider ${provider} failed: ${msg}`);
            errors.push(`${provider}: ${msg}`);
            // Continue to next provider
        }
    }

    // All providers failed — return generic fallback
    console.error(`[AI] All providers failed. Errors: ${errors.join("; ")}`);
    return generateGenericOverlay(req);
}

export async function analyzeRoom(
    req: AnalysisRequest,
    preferredProvider: AIProvider,
    config: AIConfig
): Promise<AnalysisResult> {
    const start = Date.now();
    const errors: string[] = [];

    // Provider priority chain for ANALYSIS (all support vision+text)
    const providerChain: AIProvider[] = [preferredProvider, "openrouter", "openai", "generic"]
        .filter((p, i, arr) => arr.indexOf(p) === i);

    console.log(`[AI] Starting room analysis with provider chain: ${providerChain.join(" → ")}`);

    for (const provider of providerChain) {
        try {
            switch (provider) {
                case "gemini":
                    if (!config.GEMINI_API_KEY) {
                        errors.push("Gemini: No API key configured");
                        continue;
                    }
                    return await analyzeRoomGemini(req, config);

                case "openrouter":
                    if (!config.OPENROUTER_API_KEY) {
                        errors.push("OpenRouter: No API key configured");
                        continue;
                    }
                    return await analyzeRoomOpenRouter(req, config);

                case "openai":
                    if (!config.OPENAI_API_KEY) {
                        errors.push("OpenAI: No API key configured");
                        continue;
                    }
                    return await analyzeRoomOpenAI(req, config);

                case "generic":
                    return {
                        analysis: "Room analysis temporarily unavailable. Please try again later.",
                        model: "generic-fallback",
                        provider: "generic",
                        durationMs: Date.now() - start
                    };

                default:
                    errors.push(`${provider}: Unknown provider`);
            }
        } catch (error: any) {
            const msg = error?.message || String(error);
            console.error(`[AI] ❌ Provider ${provider} failed: ${msg}`);
            errors.push(`${provider}: ${msg}`);
        }
    }

    // All providers failed
    console.error(`[AI] All analysis providers failed. Errors: ${errors.join("; ")}`);
    return {
        analysis: "Unable to analyze room at this time. All AI providers are unavailable. Please try again later.",
        model: "generic-fallback",
        provider: "generic",
        durationMs: Date.now() - start
    };
}

// =============================================================
// PROVIDER HEALTH CHECK
// =============================================================

export async function checkProviderHealth(
    provider: AIProvider,
    config: AIConfig
): Promise<{ ok: boolean; message: string; circuitOpen: boolean }> {
    const circuit = getCircuit(provider);
    
    if (provider === "generic") {
        return { ok: true, message: "Generic fallback always available", circuitOpen: false };
    }

    const apiKey = provider === "gemini" ? config.GEMINI_API_KEY :
                   provider === "openai" ? config.OPENAI_API_KEY :
                   provider === "openrouter" ? config.OPENROUTER_API_KEY : "";

    if (!apiKey) {
        return { ok: false, message: `No API key configured for ${provider}`, circuitOpen: circuit.isOpen };
    }

    if (circuit.isOpen) {
        return { ok: false, message: `Circuit breaker open (${circuit.failures} failures)`, circuitOpen: true };
    }

    // Format validation
    if (provider === "openai" && !apiKey.startsWith("sk-")) {
        return { ok: false, message: "OpenAI key format invalid (should start with sk-)", circuitOpen: false };
    }
    if (provider === "gemini" && apiKey.length < 20) {
        return { ok: false, message: "Gemini key too short", circuitOpen: false };
    }

    return { ok: true, message: `${provider} API key present (format valid)`, circuitOpen: false };
}

export async function getAllProviderHealth(config: AIConfig): Promise<Record<string, { ok: boolean; message: string; circuitOpen: boolean }>> {
    const providers: AIProvider[] = ["gemini", "openai", "openrouter", "generic"];
    const results: Record<string, any> = {};
    
    for (const provider of providers) {
        results[provider] = await checkProviderHealth(provider, config);
    }
    
    return results;
}
