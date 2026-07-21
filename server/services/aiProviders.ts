// =============================================================
// Multi-Provider AI Abstraction Layer with Auto-Failover
// Routes AI calls across Gemini, OpenAI, OpenRouter, and local models
// All provider-specific logic lives here — zero leakage to endpoints.
//
// MODEL HISTORY (for reference when updating):
// ═══════════════════════════════════════════════════════════
// 2024-Q4: gemini-1.5-pro             — DISCONTINUED (returns 404)
// 2025-Q1: gemini-2.0-flash-exp       — Shut down June 1, 2026
// 2025-Q3: gemini-2.5-flash           — Shut down June 17, 2026
// 2026-Q1: gemini-3.1-flash-image-preview / gemini-3-pro-image-preview
//          — Shut down June 25, 2026 (DO NOT use the -preview suffix)
// 2026-Q2: gemini-3.5-flash           — CURRENT analysis primary (GA)
// 2026-Q3: gemini-3.1-flash-image     — CURRENT image primary  ("Nano Banana 2", GA)
//          gemini-2.5-flash-image     — Legacy image fallback ("Nano Banana")
//          imagen-3.0-generate-002    — Paid-tier image fallback
//
// Verify currency any time Gemini breaks:
//   curl "https://generativelanguage.googleapis.com/v1beta/models?key=$KEY"
//   or check https://ai.google.dev/gemini-api/docs/changelog
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
    TELEGRAM_BOT_TOKEN?: string;
    TELEGRAM_CHAT_ID?: string;
    TELEGRAM_DAILY_REPORT_TIME?: string;
    TELEGRAM_DAILY_REPORT_ENABLED?: boolean;
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
    surfaces?: any[];
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
const CIRCUIT_THRESHOLD = 5;       // Open after 5 HARD failures
const CIRCUIT_RESET_MS = 300000;   // Auto-reset after 5 minutes (gives server time to recover)

/** Manually reset a provider's circuit breaker (call from admin endpoint). */
export function resetCircuit(provider: string): void {
    const circuit = getCircuit(provider);
    circuit.failures = 0;
    circuit.isOpen = false;
    circuit.lastFailure = 0;
    console.log(`[CircuitBreaker] ${provider} circuit manually RESET by admin`);
}

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

// Simple file logger – writes timestamped entries to logs/ai.log
const LOG_DIR = path.join(SERVER_DIR, "logs");
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}
function logToFile(level: string, msg: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${msg}\n`;
  const logPath = path.join(LOG_DIR, "ai.log");
  fs.appendFileSync(logPath, line, { encoding: "utf8" });
}
function logInfo(msg: string) { logToFile("INFO", msg); }
function logError(msg: string) { logToFile("ERROR", msg); }

const cleanBase64 = (dataURI: string) => {
    let cleaned = dataURI.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");
    cleaned = cleaned.replace(/[\r\n]/g, "");
    cleaned = cleaned.replace(/ /g, "+");
    return cleaned;
};

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
                    path.join(process.cwd(), "dist", cleanPath2),
                    path.join(process.cwd(), "public", cleanPath2),
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
                console.warn(`getImageBase64: local file not found for ${urlPath}, falling back to fetch...`);
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
        TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "",
        TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || "",
        TELEGRAM_DAILY_REPORT_TIME: process.env.TELEGRAM_DAILY_REPORT_TIME || "09:00",
        TELEGRAM_DAILY_REPORT_ENABLED: process.env.TELEGRAM_DAILY_REPORT_ENABLED === "true",
    };

    const configPath = findConfigPath();
    if (configPath) {
        try {
            const file = JSON.parse(fs.readFileSync(configPath, "utf8"));
            return {
                AI_PROVIDER: defaults.GEMINI_API_KEY ? "gemini" : (file.AI_PROVIDER || defaults.AI_PROVIDER),
                GEMINI_API_KEY: file.GEMINI_API_KEY || defaults.GEMINI_API_KEY,
                OPENAI_API_KEY: file.OPENAI_API_KEY || defaults.OPENAI_API_KEY,
                OPENROUTER_API_KEY: file.OPENROUTER_API_KEY || defaults.OPENROUTER_API_KEY,
                STRIPE_SECRET_KEY: file.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY || "",
                STRIPE_WEBHOOK_SECRET: file.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET || "",
                TELEGRAM_BOT_TOKEN: file.TELEGRAM_BOT_TOKEN || defaults.TELEGRAM_BOT_TOKEN,
                TELEGRAM_CHAT_ID: file.TELEGRAM_CHAT_ID || defaults.TELEGRAM_CHAT_ID,
                TELEGRAM_DAILY_REPORT_TIME: file.TELEGRAM_DAILY_REPORT_TIME || defaults.TELEGRAM_DAILY_REPORT_TIME,
                TELEGRAM_DAILY_REPORT_ENABLED: file.TELEGRAM_DAILY_REPORT_ENABLED !== undefined ? file.TELEGRAM_DAILY_REPORT_ENABLED : defaults.TELEGRAM_DAILY_REPORT_ENABLED,
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

const ANALYSIS_PROMPT = `You are a Senior Architectural Interior Analyst. Analyze this photo of an interior/exterior space.

Your PRIMARY task is to detect WALL PANELS with pixel-accurate bounding boxes. The product texture will be mapped exclusively to walls — floors, decks, and ceilings must be IGNORED for rendering.

Return your response in this EXACT JSON format:
{
  "text": "Brief professional analysis (max 80 words)",
  "dimensions": {
    "width": 350,
    "height": 280,
    "areaM2": 9.8
  },
  "style": "Modern Minimalist",
  "lighting": "Natural daylight from large windows",
  "suggestedMaterials": ["Wood paneling", "Textured wallpaper"],
  "surfaces": [
    {
      "type": "wall",
      "bounds": { "x": 0.05, "y": 0.1, "width": 0.9, "height": 0.55 },
      "confidence": 0.95
    }
  ]
}

CRITICAL surface detection rules:
1. Return surfaces of type "wall", "ceiling", and "floor". 
2. You MUST detect and return bounding boxes for ANY obstacles on or in front of the walls: "window", "door", "television", "cabinet", "shelf", "picture_frame", "fireplace", "light_fixture", or "furniture".
3. PAY EXTREME ATTENTION to wall-mounted cabinets (even if they are white on a white wall), picture frames, and wall decorations. If you miss them, they will be ruined by being painted over!
4. For walls: Detect the ENTIRE structural wall surface from left-to-right and top-to-bottom. Include the full bounding box of the structural wall.
5. Coordinates are normalized values (0.0 to 1.0) relative to the image dimensions.
6. For dimensions: estimate the room's width and height in CENTIMETERS, and calculate areaM2 as (width * height) / 10000.`;

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
        const surfaces = Array.isArray(parsed.surfaces) ? parsed.surfaces : undefined;

        return { analysis: text, dimensions, surfaces, model, provider, durationMs };
    } catch (e) {
        return { analysis: rawText, model, provider, durationMs };
    }
}

// =============================================================
// GENERIC FALLBACK — Always works, no API needed
// =============================================================

async function generateGenericOverlay(req: OverlayRequest): Promise<GenerationResult> {
    console.warn("[AI] All providers failed. Using generic fallback response.");
    throw new Error("AI Generation Temporarily Unavailable: All providers failed or were unavailable.");
}

// =============================================================
// GEMINI PROVIDER — Primary (best image generation)
// =============================================================

async function generateOverlayGemini(req: OverlayRequest, config: AIConfig, startTime: number): Promise<GenerationResult> {
    if (isCircuitOpen("gemini")) {
        throw new Error("Gemini circuit breaker is open — skipping due to recent failures");
    }

    const ai = getGeminiSDK(config.GEMINI_API_KEY);
    // Accept either `originalImage` (preferred) or `image` as fallback.
    const base64Data = cleanBase64(req.originalImage ?? (req as any).image);
    const mimeType = getMimeType(req.originalImage ?? (req as any).image);
    const { prompt: finalPrompt } = buildOverlayPrompt(req);
    const productRef = await getImageBase64(req.material?.imageUrl);
    const hasProductImage = !!productRef;

    const parts: any[] = [{ inlineData: { data: base64Data, mimeType } }];
    if (hasProductImage) {
        parts.push({ text: "Product Reference Image:" });
        parts.push({ inlineData: { data: productRef!.data, mimeType: productRef!.mimeType } });
    }
    parts.push({ text: finalPrompt });

    const contents = [
        {
            role: "user",
            parts
        }
    ];

    // ═══════════════════════════════════════════════════════════
    // GEMINI IMAGE MODEL FALLBACK CHAIN — Updated June 2026
    // Ordered by capability (best first).
    // NOTE: Only gemini-2.0-flash-exp supports native image OUTPUT.
    //       Newer models (3.5-flash) are vision-IN only — not used here.
    // ═══════════════════════════════════════════════════════════
    // ═══════════════════════════════════════════════════════════
    // IMAGE MODEL CHAIN — Updated July 2026 ("Nano Banana" family)
    // gemini-2.0-flash-exp was deprecated and is now 404.
    // ═══════════════════════════════════════════════════════════
    // ═══════════════════════════════════════════════════════════
    // IMAGE MODEL CHAIN — Updated July 2026
    // Google shut down gemini-3.1-flash-image-preview and
    // gemini-3-pro-image-preview on June 25, 2026, and gemini-2.0-flash
    // on June 1, 2026 (see https://ai.google.dev/gemini-api/docs/changelog).
    // Current valid image-output models:
    //   - gemini-3.1-flash-image  ("Nano Banana 2", GA — primary)
    //   - gemini-2.5-flash-image  ("Nano Banana", legacy — fallback)
    //   - imagen-3.0-generate-002 (paid tier — last resort)
    // ═══════════════════════════════════════════════════════════
    const IMAGE_MODELS = [
        { name: "gemini-3.1-flash-image", isImagen: false, supportsImageOutput: true, note: "Nano Banana 2 — primary image output" },
        { name: "gemini-2.5-flash-image", isImagen: false, supportsImageOutput: true, note: "Nano Banana — legacy fallback" },
        { name: "imagen-3.0-generate-002", isImagen: true, supportsImageOutput: true, note: "Imagen 3 — paid-tier last resort" },
    ];

    let response;
    let usedModel = IMAGE_MODELS[0].name;
    let lastError: any = null;

    for (const modelInfo of IMAGE_MODELS) {
        try {
            logInfo(`[AI] Trying Gemini model: ${modelInfo.name} (${modelInfo.note})...`);
            
            if (modelInfo.isImagen) {
                logInfo(`[AI] Calling generateImages for ${modelInfo.name}`);
                const imgResponse = await ai.models.generateImages({
                    model: modelInfo.name,
                    prompt: finalPrompt,
                    config: {
                        numberOfImages: 1,
                        outputMimeType: "image/jpeg",
                        aspectRatio: "4:3"
                    }
                });
                const base64Bytes = imgResponse.generatedImages?.[0]?.image?.imageBytes;
                if (!base64Bytes) {
                    throw new Error("No image returned from Imagen.");
                }
                response = {
                    candidates: [{
                        content: {
                            parts: [{
                                inlineData: {
                                    data: base64Bytes,
                                    mimeType: "image/jpeg"
                                }
                            }]
                        }
                    }]
                };
            } else {
                // Determine modalities: image output only for models that support it
                const modalities = modelInfo.supportsImageOutput ? ["TEXT", "IMAGE"] : ["TEXT"];
                // Log request payload (truncated for brevity)
                logInfo(`[AI] Gemini request payload for ${modelInfo.name}: ${JSON.stringify({ model: modelInfo.name, modalities })}`);
                response = await ai.models.generateContent({
                    model: modelInfo.name,
                    contents,
                    config: { responseModalities: modalities },
                });
            }
            usedModel = modelInfo.name;
            logInfo(`[AI] ✅ Gemini success with model: ${modelInfo.name}`);
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
                        config: { responseModalities: ["TEXT"] },
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

    // Analysis model fallback chain — updated July 2026.
    // gemini-2.5-flash was shut down June 17, 2026 and gemini-2.0-flash-exp
    // June 1, 2026, so they are no longer useful as fallbacks. Use the
    // current GA model with a stable variant as backup.
    const ANALYSIS_MODELS = [
        { name: "gemini-3.5-flash", note: "Primary — GA, fastest + smartest" },
        { name: "gemini-3-flash", note: "Fallback — stable previous generation" },
    ];

    let lastError: any = null;

    for (const modelInfo of ANALYSIS_MODELS) {
        try {
            const response = await ai.models.generateContent({
                model: modelInfo.name,
                contents: [
                    {
                        role: "user",
                        parts: [
                            { inlineData: { data: base64Data, mimeType } },
                            { text: ANALYSIS_PROMPT },
                        ],
                    }
                ],
                config: {
                    responseMimeType: "application/json"
                }
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

    // OpenRouter model fallback chain for image generation — updated June 2026
    // Note: Most OR models return text descriptions, not actual images.
    // Real image rendering is handled by the sharp compositor (primary path).
    const OR_IMAGE_MODELS = [
        "google/gemini-2.5-flash",                       // Latest Gemini 2.5 Flash
        "openai/gpt-4o",                                 // OpenAI GPT-4o
        "openai/gpt-4o-mini",                            // OpenAI GPT-4o Mini
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
        // Use originalImage if provided; otherwise fall back to `image`.
    const base64Data = cleanBase64(req.originalImage ?? (req as any).image);
    const mimeType = getMimeType(req.originalImage ?? (req as any).image);

    const OR_ANALYSIS_MODELS = [
        "google/gemini-2.5-flash",
        "openai/gpt-4o",
        "openai/gpt-4o-mini",
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
                max_tokens: 3000,
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
// OPENAI PROVIDER — Analysis (GPT-4o vision) + Image generation (gpt-image)
// =============================================================

/**
 * Generate a material overlay using OpenAI's GPT Image family.
 *
 * Important API details (verified July 2026):
 *   - The GPT Image models (gpt-image-2 / gpt-image-1.5 / gpt-image-1 / gpt-image-1-mini)
 *     ALWAYS return base64 image data. The `response_format` parameter is
 *     ignored and not accepted — passing it triggers a 400.
 *   - Use /v1/images/edits when we have a reference image to modify (our case:
 *     we want to repaint the user's photo with the chosen material). /v1/images/generations
 *     is text-to-image only and would ignore the user's photo entirely.
 *
 * Because GPT Image edits can return very large base64 payloads (often >1 MB),
 * we cap input image size upstream (the route already limits photos to 5 MB).
 */
async function generateOverlayOpenAI(req: OverlayRequest, config: AIConfig, startTime: number): Promise<GenerationResult> {
    if (!config.OPENAI_API_KEY) {
        throw new Error("OpenAI API key not configured");
    }
    if (isCircuitOpen("openai")) {
        throw new Error("OpenAI circuit breaker is open");
    }

    const ai = getOpenAISDK(config.OPENAI_API_KEY);
    const { prompt: finalPrompt } = buildOverlayPrompt(req);

    // GPT Image edit endpoint requires multipart form fields. The OpenAI Node
    // SDK expects the `image` parameter as a FileCreateNodePart (built via
    // OpenAI.toFile), NOT a raw Buffer — passing a Buffer produces
    // "400 Invalid type for 'image[0]': expected a file, but got a string".
    const rawImage = req.originalImage ?? (req as any).image;
    const base64Data = cleanBase64(rawImage);
    const imageBuffer = Buffer.from(base64Data.data);
    const inputMime = base64Data.mimeType;
    const ext = inputMime === "image/png" ? "png" : inputMime === "image/webp" ? "webp" : "jpg";
    const filename = `room.${ext}`;

    // Build the file part the SDK requires. toFile accepts (buffer, name, opts).
    const imagePart = await OpenAI.toFile(imageBuffer, filename, { type: inputMime });

    // Optionally include the product reference image as a second source image.
    // GPT Image edit accepts an array of file parts under `image`.
    const productRef = await getImageBase64(req.material?.imageUrl);
    const imageInput = productRef
        ? [
            imagePart,
            await OpenAI.toFile(Buffer.from(productRef.data), `product.${productRef.mimeType === "image/png" ? "png" : "jpg"}`, { type: productRef.mimeType }),
        ]
        : imagePart;

    // Chain newest → cheapest. gpt-image-2 is current as of April 2026.
    const IMAGE_MODELS = ["gpt-image-2", "gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini"];
    let lastError: any = null;

    for (const model of IMAGE_MODELS) {
        try {
            logInfo(`[AI] Trying OpenAI image model: ${model}...`);
            const response = await ai.images.edit({
                model,
                prompt: finalPrompt,
                image: imageInput as any,
                size: "1024x1024",
            });

            const b64 = (response as any).data?.[0]?.b64_json;
            const url = (response as any).data?.[0]?.url;
            if (!b64 && !url) {
                throw new Error("OpenAI returned no image data");
            }
            const image = b64 ? `data:image/png;base64,${b64}` : url;
            recordSuccess("openai");
            logInfo(`[AI] ✅ OpenAI success with model: ${model}`);
            return { image, model, durationMs: Date.now() - startTime, provider: "openai" };
        } catch (error: any) {
            lastError = error;
            const msg = error?.message || String(error);
            const status = error?.status || error?.code;
            const isModelError = msg.includes("model_not_found") ||
                                 msg.includes("does not exist") ||
                                 status === 404 ||
                                 msg.includes("Invalid model");
            const isLast = model === IMAGE_MODELS[IMAGE_MODELS.length - 1];
            if (isModelError && !isLast) {
                console.warn(`[AI] ⚠️ OpenAI model ${model} unavailable, trying next: ${msg}`);
                continue;
            }
            // 429/5xx → record failure (transient won't trip breaker) and try next
            recordFailure("openai", error);
            if (!isLast) {
                console.warn(`[AI] ⚠️ OpenAI model ${model} failed (${msg}), trying next...`);
                continue;
            }
            throw error;
        }
    }

    recordFailure("openai", lastError);
    throw lastError || new Error("All OpenAI image models failed");
}

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

    // Try GPT-4o first (best vision), fall back to gpt-4o-mini (cheaper/faster).
    // Override the chain via OPENAI_VISION_MODEL env if a newer model lands.
    const ANALYSIS_MODELS = process.env.OPENAI_VISION_MODEL
        ? [process.env.OPENAI_VISION_MODEL]
        : ["gpt-4o", "gpt-4o-mini"];

    let lastError: any = null;
    for (const model of ANALYSIS_MODELS) {
        try {
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
                max_tokens: 3000,
                response_format: { type: "json_object" },
            } as any);

            const rawText = completion.choices[0]?.message?.content || "{\"text\":\"Could not analyze.\"}";
            recordSuccess("openai");
            return parseAnalysisResponse(rawText, model, "openai", Date.now() - start);
        } catch (error: any) {
            lastError = error;
            const msg = error?.message || String(error);
            const isLast = model === ANALYSIS_MODELS[ANALYSIS_MODELS.length - 1];
            // Quota/auth errors should break out immediately rather than waste
            // a second call on the cheaper model.
            const status = error?.status || error?.code;
            if (status === 401 || status === 403 || msg.includes("API key")) {
                recordFailure("openai", error);
                throw error;
            }
            if (!isLast) {
                console.warn(`[AI] ⚠️ OpenAI vision model ${model} failed, trying next: ${msg}`);
                continue;
            }
            recordFailure("openai", error);
            throw error;
        }
    }

    throw lastError || new Error("All OpenAI analysis models failed");
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
    // Gemini (native image output) → OpenAI (gpt-image) → OpenRouter (unified) → generic
    const providerChain: AIProvider[] = [preferredProvider, "openai", "openrouter", "generic"]
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

                case "openai":
                    if (!config.OPENAI_API_KEY) {
                        errors.push("OpenAI: No API key configured");
                        continue;
                    }
                    return await generateOverlayOpenAI(req, config, start);

                case "openrouter":
                    if (!config.OPENROUTER_API_KEY) {
                        errors.push("OpenRouter: No API key configured");
                        continue;
                    }
                    return await generateOverlayOpenRouter(req, config, start);

                case "generic":
                    return await generateGenericOverlay(req);

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

    // Format validation — intentionally lenient. Provider key formats change
    // over time (e.g. OpenAI project keys `sk-proj-...`, Gemini Vertex/Cloud
    // service-account keys start with `AQ.` instead of `AIzaSy...`). Rejecting
    // a key on a prefix guess masks the real failure, which is whatever the
    // provider returns on the actual API call. The only hard signal we trust
    // is the live API response — see testAIConnection().
    if (provider === "openai" && apiKey.length < 20) {
        return { ok: false, message: "OpenAI key too short", circuitOpen: false };
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

export async function testAIConnection(config: AIConfig): Promise<any> {
    const results: any = {
        geminiText: {},
        geminiImageModels: {},
        openrouter: {},
        env: {
            GEMINI_API_KEY_len: config.GEMINI_API_KEY ? config.GEMINI_API_KEY.length : 0,
            OPENAI_API_KEY_len: config.OPENAI_API_KEY ? config.OPENAI_API_KEY.length : 0,
            OPENROUTER_API_KEY_len: config.OPENROUTER_API_KEY ? config.OPENROUTER_API_KEY.length : 0,
            GEMINI_API_KEY_masked: config.GEMINI_API_KEY ? `${config.GEMINI_API_KEY.slice(0, 5)}...${config.GEMINI_API_KEY.slice(-4)}` : "missing",
            OPENAI_API_KEY_masked: config.OPENAI_API_KEY ? `${config.OPENAI_API_KEY.slice(0, 5)}...${config.OPENAI_API_KEY.slice(-4)}` : "missing",
            OPENROUTER_API_KEY_masked: config.OPENROUTER_API_KEY ? `${config.OPENROUTER_API_KEY.slice(0, 5)}...${config.OPENROUTER_API_KEY.slice(-4)}` : "missing",
        }
    };

    const ai = config.GEMINI_API_KEY ? getGeminiSDK(config.GEMINI_API_KEY) : null;

    // 1. Test Gemini Text
    if (ai) {
        try {
            const response = await ai.models.generateContent({
                model: "gemini-3.5-flash",
                contents: "Hello, reply with only the word 'OK'.",
            });
            results.geminiText = {
                success: true,
                response: response.text ? response.text.trim() : "(empty response)",
            };
        } catch (e: any) {
            results.geminiText = {
                success: false,
                error: e.message || String(e),
                status: e.status || e.code,
            };
        }

        // Test each Gemini image model candidate (Nano Banana family)
        const candidateImageModels = [
            "gemini-3.1-flash-image",
            "gemini-2.5-flash-image",
        ];

        for (const model of candidateImageModels) {
            try {
                // We ask for text response only to make it fast, but using IMAGE modality setting to check if supported
                const response = await ai.models.generateContent({
                    model: model,
                    contents: "Hi, verify model connectivity.",
                    config: { responseModalities: ["TEXT", "IMAGE"] }
                });
                results.geminiImageModels[model] = {
                    success: true,
                    response: response.text ? response.text.trim() : "OK (response success)"
                };
            } catch (e: any) {
                results.geminiImageModels[model] = {
                    success: false,
                    error: e.message || String(e),
                    status: e.status || e.code
                };
            }
        }
    } else {
        results.geminiText = { success: false, error: "No Gemini API key configured" };
    }

    // 2. Test OpenRouter
    try {
        if (!config.OPENROUTER_API_KEY) {
            throw new Error("No OpenRouter API key configured");
        }
        const orAi = getOpenRouterSDK(config.OPENROUTER_API_KEY);
        const response = await orAi.chat.completions.create({
            model: "google/gemini-2.5-flash",
            messages: [{ role: "user", content: "Hello, reply with only the word 'OK'." }],
            max_tokens: 10,
        });
        results.openrouter = {
            success: true,
            response: response.choices[0]?.message?.content ? response.choices[0].message.content.trim() : "(empty response)",
        };
    } catch (e: any) {
        results.openrouter = {
            success: false,
            error: e.message || String(e),
            status: e.status || e.code,
        };
    }

    // 3. Test OpenAI (vision + image availability)
    results.openai = {};
    results.openaiImageModels = {};
    try {
        if (!config.OPENAI_API_KEY) {
            throw new Error("No OpenAI API key configured");
        }
        const oai = getOpenAISDK(config.OPENAI_API_KEY);
        const completion = await oai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: "Reply with only the word OK." }],
            max_tokens: 10,
        });
        results.openai = {
            success: true,
            response: completion.choices[0]?.message?.content?.trim() || "(empty)",
        };

        // Verify each candidate image model is reachable. We use a cheap edit
        // call (1 image, small) so this still costs a few cents per model.
        // Skip if OPENAI_SKIP_IMAGE_PROBE=1 to save cost on routine health checks.
        if (process.env.OPENAI_SKIP_IMAGE_PROBE !== "1") {
            const probeModels = ["gpt-image-2", "gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini"];
            for (const m of probeModels) {
                try {
                    // 1x1 transparent PNG — minimal valid image input.
                    // Must wrap with OpenAI.toFile or the SDK rejects it.
                    const probePng = Buffer.from(
                        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
                        "base64"
                    );
                    const probeFile = await OpenAI.toFile(probePng, "probe.png", { type: "image/png" });
                    const r = await oai.images.edit({
                        model: m,
                        prompt: "noop probe, do nothing",
                        image: probeFile,
                        size: "1024x1024",
                    });
                    results.openaiImageModels[m] = {
                        success: !!(r.data?.[0]?.b64_json || r.data?.[0]?.url),
                    };
                } catch (e: any) {
                    results.openaiImageModels[m] = {
                        success: false,
                        error: e.message || String(e),
                        status: e.status || e.code,
                    };
                }
            }
        }
    } catch (e: any) {
        results.openai = {
            success: false,
            error: e.message || String(e),
            status: e.status || e.code,
        };
    }

    return results;
}
