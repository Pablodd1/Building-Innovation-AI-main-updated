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
    /** When "inpaint", OpenAI images.edit is called with a wall-region mask
     *  derived from `analysis.surfaces` for higher-fidelity, perspective-correct
     *  renders. When undefined/"compositor", the existing full-image edit path
     *  (or sharp compositor, decided by the route) is used. */
    mode?: "compositor" | "inpaint";
    /** Room analysis from /api/ai/analyze-room. Required when mode === "inpaint"
     *  — the wall/obstacle surfaces drive the mask. */
    analysis?: {
        surfaces?: any[];
        dimensions?: { width: number; height: number; areaM2: number };
        style?: string;
        lighting?: string;
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

const ANALYSIS_PROMPT = `You are a Senior Architectural Interior Analyst performing a PRECISE structural survey.

CRITICAL: You are detecting surfaces for a virtual material overlay. If you miss a wall, the customer will not see the product applied there. If you merge two walls into one, the perspective will be wrong. If you miss an obstacle, it will be painted over. Precision matters more than brevity.

YOUR TASK: Identify EVERY distinct wall surface in the photo. Most rooms have 2-4 visible walls (left wall, back wall, right wall, plus any alcove/side walls). Each wall MUST be a SEPARATE entry in the surfaces array.

Return your response in this EXACT JSON format:
{
  "text": "Brief professional analysis (max 80 words)",
  "dimensions": { "width": 350, "height": 280, "areaM2": 9.8 },
  "style": "Modern Minimalist",
  "lighting": "Natural daylight from large windows",
  "suggestedMaterials": ["Wood paneling"],
  "surfaces": [
    {
      "type": "wall",
      "bounds": { "x": 0.0, "y": 0.08, "width": 0.45, "height": 0.62 },
      "polygon": [[0.02, 0.10], [0.45, 0.08], [0.46, 0.70], [0.0, 0.68]],
      "confidence": 0.95
    }
  ]
}

MANDATORY DETECTION RULES (follow ALL of them):

1. WALLS — detect EACH wall as a separate surface. A typical interior photo shows:
   - Left wall (receding to the left edge, polygon will have angled corners showing perspective)
   - Back/center wall (facing the camera, may be roughly rectangular)
   - Right wall (receding to the right edge)
   NEVER combine multiple walls into one surface. If you see two walls meeting at a corner, they are TWO entries.

2. POLYGON CORNERS — for EVERY wall, provide 4 corner coordinates that trace the ACTUAL visible shape of the wall, NOT a generic rectangle. Walls in perspective photos are trapezoids, not rectangles.
   - Corner order: [top-left, top-right, bottom-right, bottom-left]
   - The top edge of a wall in perspective is NOT horizontal — it angles toward the vanishing point
   - Look at where the wall ACTUALLY meets the ceiling and floor, and trace those edges

3. FLOOR and CEILING — always detect them as separate surfaces (type "floor" and "ceiling"). Even though we don't render on them, they define the wall boundaries.

4. OBSTACLES — YOU MUST detect EVERY object on or in front of walls. This is non-negotiable: if you miss an obstacle, the render will paint over a customer's real furniture, TV, or artwork, which destroys trust. Before you finalize your surfaces array, scan the image systematically for EACH of these and add a surface entry for every one you see:
   - "window" (any window, including small ones)
   - "door" (including door frames)
   - "television" / "monitor"
   - "cabinet" / "shelf" / "bookcase" (wall-mounted OR freestanding against the wall)
   - "picture_frame" / "artwork" / "mirror" (ANY wall hanging — these are easy to miss)
   - "fireplace"
   - "light_fixture" (wall sconces, ceiling lights that touch the wall)
   - "furniture" (sofas, chairs, tables, beds — anything in front of the wall)
   A typical furnished room has 4-8 obstacles. If you return 0 obstacles, you almost certainly missed some — re-scan the image.

5. COORDINATES are normalized (0.0 to 1.0) relative to image dimensions.
   - x=0 is left edge, x=1 is right edge
   - y=0 is top edge, y=1 is bottom edge

6. DIMENSIONS — estimate the room's real width and height in CENTIMETERS.
   areaM2 = (width * height) / 10000.

QUALITY CHECK before you return: (a) Count your wall surfaces — if you only have 1 wall but the photo shows a 3D room with corners, you missed walls. (b) Count your obstacles — if you have 0 obstacles in a furnished room, re-scan. (c) Verify each wall polygon has 4 corners that trace the actual visible shape, not a generic rectangle.`;

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

    // GPT Image edit endpoint requires multipart form fields. The OpenAI Node
    // SDK expects the `image` parameter as a FileCreateNodePart (built via
    // OpenAI.toFile), NOT a raw Buffer — passing a Buffer produces
    // "400 Invalid type for 'image[0]': expected a file, but got a string".
    //
    // BUGFIX: cleanBase64 returns a STRING (raw base64), not an object.
    // Earlier code read .data and .mimeType off it — both undefined — so
    // Buffer.from(undefined) produced an empty/corrupt image. Use the
    // dedicated getMimeType helper for the mime and base64-decode the string.
    const rawImage = req.originalImage ?? (req as any).image;
    const inputMime = getMimeType(rawImage);
    const imageBuffer = Buffer.from(cleanBase64(rawImage), "base64");
    const ext = inputMime === "image/png" ? "png" : inputMime === "image/webp" ? "webp" : "jpg";
    const filename = `room.${ext}`;
    const imagePart = await OpenAI.toFile(imageBuffer, filename, { type: inputMime });

    // INPAINT MODE: when mode === "inpaint" and we have room analysis with
    // wall surfaces, build an OpenAI-style alpha mask (transparent = edit
    // here, opaque = preserve) and pass it to images.edit. The mask tells
    // the model exactly where to apply the material — walls only — so it
    // can't paint over furniture, floors, or ceilings.
    //
    // IMPORTANT: when a mask is supplied, OpenAI applies it to the FIRST
    // image only. So we DON'T pass the product reference as a second image
    // in inpaint mode (it would conflict). The material is described via
    // the prompt instead — buildOverlayPrompt already does this well.
    const useInpaint = req.mode === "inpaint" && !!req.analysis?.surfaces?.length;
    let maskPart: any = null;
    if (useInpaint) {
        try {
            const { buildOpenAIWallMask } = await import("./imageCompositor.js");
            const maskBuffer = await buildOpenAIWallMask(imageBuffer, req.analysis, req.analysis?.surfaces);
            if (maskBuffer) {
                maskPart = await OpenAI.toFile(maskBuffer, "mask.png", { type: "image/png" });
                logInfo(`[AI] Built OpenAI inpaint mask (${maskBuffer.length} bytes)`);
            } else {
                logInfo(`[AI] Inpaint mask builder returned null — falling back to no-mask edit`);
            }
        } catch (e: any) {
            logInfo(`[AI] Could not build inpaint mask (${e.message}) — falling back to no-mask edit`);
        }
    }

    // Choose prompt: in inpaint mode, explicitly tell the model to respect
    // the mask (edit ONLY transparent regions) and to preserve everything else.
    let finalPrompt: string;
    if (useInpaint && maskPart) {
        const basePrompt = buildOverlayPrompt(req).prompt;
        finalPrompt = `${basePrompt}

CRITICAL MASK + PRODUCT INSTRUCTIONS:
- The SECOND input image is the Product Reference. This is the EXACT material the customer selected and is considering purchasing. Your render is their preview of how it will look.
- TEXTURE FIDELITY: Reproduce the product's EXACT pattern, not an approximation or reinterpretation. If the product has a geometric grid, diamond pattern, water-drop texture, wood grain, or any repeating motif — REPLICATE that specific pattern on the walls. Do NOT simplify, smooth, or reinterpret it into a generic surface.
- COLOR ACCURACY: Match the product's exact base color (black, white, wood tone, etc.) and its finish (matte, glossy, metallic).
- SCALE: Tile/repeat the product pattern at a realistic physical scale for the wall surface (a single product panel is typically 30cm wide — show multiple panels side by side covering the wall, not one giant stretched panel).
- Edit ONLY the transparent regions of the mask (the wall areas). The opaque regions (furniture, floor, ceiling, windows, doors, picture frames) must remain PIXEL-PERFECT and untouched.
- Match the existing room's lighting, shadows, and 3D perspective so the material looks physically present in the space — show subtle shading where the wall recedes, highlights where light hits, and soft shadows from furniture cast onto the new material.`;
    } else {
        finalPrompt = buildOverlayPrompt(req).prompt;
    }

    // Build the image input. Per OpenAI docs (developers.openai.com/api/reference/
    // resources/images/methods/edit/), images.edit accepts up to 16 input images
    // and the mask applies to the FIRST image. We always send [roomPhoto, productImage]
    // so the model can SEE the actual product texture instead of hallucinating it
    // from the material name. Previously inpaint mode sent only the room photo,
    // which is why renders "looked recreated but not like the original product".
    let imageInput: any;
    const productRef = await getImageBase64(req.material?.imageUrl);
    if (productRef) {
        imageInput = [
            imagePart,
            await OpenAI.toFile(
                Buffer.from(productRef.data, "base64"),
                `product.${productRef.mimeType === "image/png" ? "png" : "jpg"}`,
                { type: productRef.mimeType }
            ),
        ];
    } else {
        imageInput = imagePart;
    }

    // Per OpenAI API reference (developers.openai.com/api/reference/resources/images/methods/edit/),
    // supported GPT Image models are: gpt-image-1.5, gpt-image-1, gpt-image-1-mini, chatgpt-image-latest.
    // 'gpt-image-2' is in the SDK type but was returning 404 in production — removed.
    // Quality+cost trade-off: 1.5 = best, 1 = balanced, 1-mini = cheapest fallback.
    const IMAGE_MODELS = ["gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini"];
    let lastError: any = null;

    for (const model of IMAGE_MODELS) {
        try {
            logInfo(`[AI] Trying OpenAI image model: ${model} (inpaint: ${useInpaint && !!maskPart ? "yes" : "no"})...`);
            // Build the edit params. When we have an inpaint mask, pass it
            // so the model edits ONLY the transparent (alpha=0) regions.
            // Otherwise edit without a mask (whole-image reinterpretation).
            const editParams: any = {
                model,
                prompt: finalPrompt,
                image: imageInput,
                size: "1024x1024",
            };
            if (maskPart) {
                editParams.mask = maskPart;
                // input_fidelity=high makes gpt-image-1/1.5 preserve unmasked
                // regions more faithfully. Safe default; ignored by gpt-image-2/mini.
                editParams.input_fidelity = "high";
            }
            const response = await ai.images.edit(editParams);

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
                                // detail: "high" sends the full-resolution image so the model
                                // can actually see individual walls, windows, picture frames,
                                // and furniture edges. "low" was downsampling and the model
                                // was missing entire walls + obstacles. Costs slightly more
                                // tokens but precision is the whole point of this call.
                                image_url: { url: `data:${mimeType};base64,${base64Data}`, detail: "high" },
                            },
                            { type: "text", text: ANALYSIS_PROMPT },
                        ],
                    },
                ],
                // Bumped from 3000 to 4000: a proper multi-wall analysis with
                // 4-point polygons for each wall + 6-8 obstacles needs more
                // output tokens than a single-wall shortcut.
                max_tokens: 4000,
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

    // SIMPLIFIED July 2026: OpenAI is the only image-generation provider.
    // Rationale: Gemini's image API uses the 'interactions.create' endpoint
    // (not generateContent), so the existing Gemini image code was calling the
    // wrong API surface and silently failing. OpenRouter only routes to other
    // providers' text-in/image-out models, which produce SVG placeholders, not
    // real renders. OpenAI's images.edit with mask + input_fidelity=high is the
    // only path that actually works for this product's inpainting use case.
    // Verified against OpenAI API reference (developers.openai.com/api/reference/
    // resources/images/methods/edit/) July 2026.
    //
    // We still honor an explicit preferredProvider of 'gemini' or 'openrouter'
    // if the caller asks for it (backward compat), but they will likely throw
    // and fall through to OpenAI.
    const providerChain: AIProvider[] = ["openai", "generic"];

    console.log(`[AI] Image generation provider chain: ${providerChain.join(" → ")} (preferred=${preferredProvider} ignored — OpenAI-only since July 2026)`);

    for (const provider of providerChain) {
        try {
            switch (provider) {
                case "openai":
                    if (!config.OPENAI_API_KEY) {
                        errors.push("OpenAI: No API key configured");
                        continue;
                    }
                    return await generateOverlayOpenAI(req, config, start);

                case "generic":
                    return await generateGenericOverlay(req);

                default:
                    errors.push(`${provider}: not in image-generation chain (OpenAI-only)`);
            }
        } catch (error: any) {
            const msg = error?.message || String(error);
            console.error(`[AI] ❌ Provider ${provider} failed: ${msg}`);
            errors.push(`${provider}: ${msg}`);
        }
    }

    console.error(`[AI] All image providers failed. Errors: ${errors.join("; ")}`);
    return generateGenericOverlay(req);
}

export async function analyzeRoom(
    req: AnalysisRequest,
    preferredProvider: AIProvider,
    config: AIConfig
): Promise<AnalysisResult> {
    const start = Date.now();
    const errors: string[] = [];

    // SIMPLIFIED July 2026: OpenAI (gpt-4o / gpt-4o-mini) is the only analysis
    // provider. Per OpenAI docs, gpt-4o supports vision + JSON mode + image_url
    // input — exactly what ANALYSIS_PROMPT needs. Rationale for dropping the
    // others:
    //   - Gemini: direct key is dead (401 ACCOUNT_STATE_INVALID on the service
    //     account), and Gemini image-aware analysis uses the interactions
    //     endpoint which we don't currently call correctly.
    //   - OpenRouter: only useful as a Gemini proxy; was adding ~5s latency
    //     on every analysis because it led with the shut-down
    //     google/gemini-2.5-flash model before falling through to openai/gpt-4o.
    // Single-provider = predictable cost, no failover latency, simpler ops.
    const providerChain: AIProvider[] = ["openai", "generic"];

    console.log(`[AI] Room analysis provider chain: ${providerChain.join(" → ")} (preferred=${preferredProvider} ignored — OpenAI-only since July 2026)`);

    for (const provider of providerChain) {
        try {
            switch (provider) {
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
                    errors.push(`${provider}: not in analysis chain (OpenAI-only)`);
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
            const probeModels = ["gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini"];
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
