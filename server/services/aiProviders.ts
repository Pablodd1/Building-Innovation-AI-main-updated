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
import sharp from "sharp";

// ---- Types ----

export type AIProvider = "gemini" | "openai" | "openrouter" | "flux" | "generic";

export interface AIConfig {
    AI_PROVIDER: AIProvider;
    GEMINI_API_KEY: string;
    OPENAI_API_KEY: string;
    OPENROUTER_API_KEY: string;
    // fal.ai key for FLUX.1 Fill inpainting (the high-fidelity renderer).
    // When set, the inpaint path prefers FLUX over gpt-image-1.5 because
    // FLUX composites unmasked pixels back 1:1 — furniture/pattern preservation
    // becomes a mathematical guarantee, not a prompt hope. (gpt-image-1.5
    // does a soft-mask full-image regeneration per OpenAI staff confirmation.)
    FAL_API_KEY: string;
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

// Magic-byte signatures for the image formats we accept. Used to detect the
// (common) case where Google Drive returns an HTML interstitial / virus-warning
// page instead of the actual image bytes — without this check we'd silently
// base64-encode HTML and hand it to OpenAI as the "product image", which is a
// leading cause of renders that look "recreated, not like the actual product".
const IMAGE_SIGNATURES: Array<{ mime: string; head: number[] }> = [
    { mime: "image/jpeg", head: [0xff, 0xd8, 0xff] },        // JPEG
    { mime: "image/png",  head: [0x89, 0x50, 0x4e, 0x47] },  // PNG
    { mime: "image/gif",  head: [0x47, 0x49, 0x46, 0x38] },  // GIF8
    { mime: "image/webp", head: [0x52, 0x49, 0x46, 0x46] },  // "RIFF" (WEBP container)
];

function sniffImageMime(buf: Buffer): string | null {
    if (buf.length < 12) return null;
    for (const sig of IMAGE_SIGNATURES) {
        let ok = true;
        for (let i = 0; i < sig.head.length; i++) {
            if (buf[i] !== sig.head[i]) { ok = false; break; }
        }
        if (ok) {
            // RIFF container could be WAV/AVI; only call it WEBP if "WEBP" appears at offset 8.
            if (sig.mime === "image/webp" && buf.toString("ascii", 8, 12) !== "WEBP") continue;
            return sig.mime;
        }
    }
    return null;
}

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
            // Send User-Agent + Drive Referer. Without these, Google Drive's
            // uc?export=view endpoint frequently returns an HTML interstitial
            // (virus-warning page) for non-trivially-sized images. The same
            // workaround already exists in imageCompositor.getProductImageBuffer.
            const isDrive = urlPath.includes("drive.google.com") || urlPath.includes("googleusercontent.com");
            const response = await fetch(urlPath, {
                headers: {
                    "User-Agent": "BuildingInnovationAI/1.0 (+https://buildingapp.us)",
                    ...(isDrive ? { "Referer": "https://drive.google.com" } : {}),
                },
                redirect: "follow",
            });
            if (!response.ok) return null;
            const buffer = Buffer.from(await response.arrayBuffer());

            // Belt-and-suspenders: reject HTML responses and sniff magic bytes.
            // Content-Type alone is unreliable — Drive sometimes returns image/*
            // headers on an HTML body. Sniffing catches both.
            const headerMime = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
            if (headerMime === "text/html" || headerMime.startsWith("text/")) {
                console.warn(`getImageBase64: rejecting text/html response from ${urlPath} (likely Drive interstitial)`);
                return null;
            }
            const sniffed = sniffImageMime(buffer);
            if (!sniffed) {
                console.warn(`getImageBase64: bytes from ${urlPath} are not a recognized image (no magic byte match)`);
                return null;
            }
            return { data: buffer.toString("base64"), mimeType: sniffed };
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
        FAL_API_KEY: process.env.FAL_API_KEY || "",
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
                FAL_API_KEY: file.FAL_API_KEY || defaults.FAL_API_KEY,
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
2. EXACT OVERLAY: Apply the EXACT texture, pattern, color, and scale from the Product Reference image onto the target surface. Do not soften, simplify, or reinterpret the pattern — copy it faithfully at the correct scale.
3. PRESERVE FOREGROUND (highest priority): You MUST flawlessly preserve and cut around all objects IN FRONT of the surface (furniture, people, plants, windows, wall-mounted items, art, TVs, doors). DO NOT paint over them, DO NOT move them, DO NOT replace them, DO NOT restyle them. They must appear pixel-faithful to the original photo.
4. PERSPECTIVE & LIGHTING: Match the room's 3D perspective exactly. Re-apply the original room's shadows, reflections, and highlights over the new material so it blends perfectly.
5. Lighting conditions: ${lightingHint}

FORBIDDEN (anti-hallucination — these are hard failures):
- Do NOT invent new objects that were not in the original photo (no added furniture, plants, art, lamps, rugs, windows, or doors).
- Do NOT remove objects that were in the original photo (no "cleaned up" furniture, no deleted wall art).
- Do NOT change the room's geometry — walls, ceiling height, and floor layout stay identical.
- Do NOT change the camera angle or crop.
- Do NOT "improve" the original photo's lighting or color balance.
- Do NOT alter the color, pattern, or finish of the Product Reference material.

OUTPUT: A single photorealistic image, identical to the original photo except that the target wall surfaces now show the Product Reference material. Output ONLY the final image, no text, no explanation.`;
    }

    return { prompt, isFurniture };
}

const ANALYSIS_PROMPT = `You are a precision architectural scanner. Your output drives an automated material-overlay system: every surface you return becomes a renderable region, and every obstacle you return becomes a protected mask. Errors are visible to customers.

═══════════════════════════════════════════════════════════════
THE TWO FAILURE MODES — BOTH ARE EQUALLY BAD
═══════════════════════════════════════════════════════════════
You are balancing between two opposite failure modes. Calibrate to the middle:
  FAILURE A — HALLUCINATION: returning an object that is not actually in the photo, or coordinates that don't match the pixels.
  FAILURE B — OMISSION: failing to return an object that IS clearly visible in the photo.
Both destroy the render. Do not swing to either extreme. If you can see a chair, a TV, a painting, or a lamp in the photo, you MUST emit it as an obstacle — that is not hallucination, that is the job.

═══════════════════════════════════════════════════════════════
WORK IN THIS ORDER (mandatory)
═══════════════════════════════════════════════════════════════
Fill the "reasoning" object FIRST, then build "surfaces" from it. The reasoning field is where you commit to what you actually see before writing any coordinates.

reasoning.vanishingPoint: [x, y] — approximate normalized location where wall/ceiling/floor lines converge. If the photo is a flat-on view with no perspective, write [0.5, 0.5].
reasoning.observedObjects: list EVERY discrete object you can see, as a one-line cue. Examples: "yellow armchair at center-left, lower third", "wall-mounted TV upper-right, dark rectangle", "wooden floor lower third". A real furnished room typically has 4-10 of these. Be exhaustive — this list IS your detection list.
reasoning.wallPlanes: one short sentence per visible wall plane, naming direction + the corner cue.
reasoning.ambiguous: anything you were unsure about and how you called it, or "none".

EVERY object you list in reasoning.observedObjects MUST appear as a surface (type "furniture" or its specific type) with matching bounds. Skipping an observed object is FAILURE B.

═══════════════════════════════════════════════════════════════
ANTI-HALLUCINATION CONTRACT (applies to every coordinate)
═══════════════════════════════════════════════════════════════
- You are describing THIS photograph, not a generic room. Every surface must correspond to pixels you can point to.
- DO NOT GUESS COORDINATES. Before writing any polygon or bounds, locate the object visually relative to the image frame (e.g. "starts 10% from the left edge", "top edge aligns with the ceiling line", "bottom edge sits on the floor").
- Calibration anchors — the ENTIRE image is the unit square [0,1] x [0,1] with (0,0) at top-left:
    x=0   → left edge of photo      x=1   → right edge of photo
    y=0   → top edge of photo        y=1   → bottom edge of photo
    x=0.5 → vertical centerline      y=0.5 → horizontal centerline
- Each surface MUST include an "evidence" string citing the specific visual cue that places it there (e.g. "yellow chair seat at y≈0.55, backrest reaches y≈0.35, occupies x≈0.18 to x≈0.40"). Generic phrases like "the wall" are not acceptable evidence.

═══════════════════════════════════════════════════════════════
SCANNING METHODOLOGY
═══════════════════════════════════════════════════════════════
1. Identify vanishing point(s) — where do wall edges, ceiling lines, and floor lines converge?
2. Trace EACH wall plane corner-to-corner. Most rooms in a single photo contain 2-3 visible wall planes (left, back/center, right). Add a 4th only if there is a clear alcove, niche, or protruding section.
3. For each wall, follow where it physically meets the ceiling, floor, and adjacent walls. Walls in perspective are TRAPEZOIDS — their top and bottom edges converge toward the vanishing point, they are NOT horizontal and NOT simple rectangles. If your wall polygon is a rectangle, you are NOT tracing perspective — redo it.
4. Then SCAN FOR OBSTACLES (do this BEFORE finalizing walls so walls don't absorb obstacles): ceiling fixtures → wall-mounted items (cabinets, shelves, art, mirrors, sconces, TVs) → door frames and windows → freestanding furniture touching or in front of the wall. Each discrete obstacle gets its own surface entry.

═══════════════════════════════════════════════════════════════
OUTPUT SCHEMA — return EXACTLY this JSON, nothing else
═══════════════════════════════════════════════════════════════
{
  "reasoning": {
    "vanishingPoint": [<x>, <y>],
    "observedObjects": ["<one line per visible object: type + position + cue>"],
    "wallPlanes": ["<one short sentence per wall plane>"],
    "ambiguous": ["<resolved ambiguities, or 'none'>"]
  },
  "text": "≤60 word professional summary of THIS specific room (cite at least 2 concrete objects you can see)",
  "dimensions": { "width": <cm>, "height": <cm>, "areaM2": <m²> },
  "style": "<design style observed in THIS image>",
  "lighting": "<light source + quality observed in THIS image>",
  "suggestedMaterials": ["<material 1>", "<material 2>"],
  "surfaces": [
    {
      "type": "wall",
      "evidence": "<specific visual cue with anchor coordinates>",
      "bounds": { "x": <0-1>, "y": <0-1>, "width": <0-1>, "height": <0-1> },
      "polygon": [[<x>,<y>], [<x>,<y>], [<x>,<y>], [<x>,<y>]],
      "confidence": <0-1>
    }
  ]
}

═══════════════════════════════════════════════════════════════
POLYGON GEOMETRY (this matters — rectangles are wrong for perspective walls)
═══════════════════════════════════════════════════════════════
- 4 corners in clockwise order starting top-left: TL → TR → BR → BL.
- Trace the ACTUAL visible wall edges, including perspective angles.
- A receding wall's far edge is SHORTER than its near edge (trapezoid).
- HARD RULE: a wall polygon is INVALID if TL.x == BL.x AND TR.x == BR.x (axis-aligned rectangle). Walls in real photos are NEVER perfect rectangles — perspective always angles at least one edge. If your polygon is a rectangle, you have not traced perspective, you have written a lazy bbox. Redo it.
- The grid overlay you see (10x10 cells labeled c0-c9 across the top, r0-r9 down the left) is there to help you anchor coordinates. Use it: a corner "at column 3, row 2" is x=0.3, y=0.2.
- All coordinates normalized [0.0-1.0], (0,0) = top-left of image.

═══════════════════════════════════════════════════════════════
GRID OVERLAY (the yellow labels on the image)
═══════════════════════════════════════════════════════════════
- The image you are analyzing has a 10x10 grid drawn over it for calibration.
- Yellow "c0"-"c9" labels along the top edge = column indices (x direction).
- Yellow "r0"-"r9" labels along the left edge = row indices (y direction).
- When estimating a coordinate, anchor it to a grid cell: "the chair seat is centered around column 2, row 6 → x=0.25, y=0.62". This dramatically improves your precision.
- The grid is just an aid — your final coordinates must still be normalized floats in [0,1], not cell references.

═══════════════════════════════════════════════════════════════
SURFACE TYPES — return one entry per distinct surface
═══════════════════════════════════════════════════════════════
- "wall" — each wall plane is a SEPARATE entry (never merge two walls).
- "floor" — the visible floor surface (omit if not visible).
- "ceiling" — the visible ceiling surface (omit if not visible).
- Obstacles (MANDATORY for every visible object): "window" | "door" | "television" | "cabinet" | "shelf" | "picture_frame" | "mirror" | "fireplace" | "light_fixture" | "radiator" | "furniture"
  - For unfamiliar shapes, use "furniture" with a precise evidence string.
  - A chair, sofa, table, lamp, plant, or rug ALWAYS counts as an obstacle.

═══════════════════════════════════════════════════════════════
CONFIDENCE CALIBRATION (be honest, but do not omit what you can see)
═══════════════════════════════════════════════════════════════
- 0.9-1.0: object is unambiguous, edges clearly visible.
- 0.7-0.89: object is clearly present but one edge is partially occluded.
- 0.5-0.69: object is clearly present but its exact bounds are uncertain (still return it — better to have an approximate mask than none).
- Below 0.5: only for objects you are not sure exist at all. If you can see it, confidence ≥ 0.5.

═══════════════════════════════════════════════════════════════
QUALITY GATES (self-check before returning)
═══════════════════════════════════════════════════════════════
- Wall count ≥ 2 for any 3D room photo (1 wall = you merged planes, re-scan).
- Obstacle count must EQUAL the count of objects you listed in reasoning.observedObjects. If they don't match, you forgot to promote an observation to a surface — go back.
- Each wall polygon has exactly 4 corners that form a non-degenerate quadrilateral (area > 0.01 of the image).
- Wall bounds should NOT cover the entire image — if a wall bounds covers > 60% of the image area, you have included obstacles inside the wall. Cut them out.
- Every "evidence" string cites a specific visual cue with approximate coordinates.

DIMENSIONS: estimate real-world width × height in centimeters; areaM2 = (w × h) / 10000.`;

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

        // Surface the model's reasoning block in server logs so we can audit
        // whether it actually scanned the room or shortcut to coordinates.
        // This is a debug aid — it is not returned to the client.
        if (parsed.reasoning) {
            try {
                const r = parsed.reasoning;
                console.log(`[Analysis.reasoning] vanishing=${JSON.stringify(r.vanishingPoint)} walls=${(r.wallPlanes || []).length} observedObjects=${(r.observedObjects || []).length} ambiguous=${JSON.stringify(r.ambiguous)}`);
            } catch { /* best-effort log */ }
        }

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
        // Expert-grade inpaint prompt based on AtlasCloud/OpenAI community research:
        // - Use technical material terms (not "vibe" words) to lock the model on physical properties
        // - Limit to 3-4 explicit change directives (overloading degrades mask fidelity)
        // - Lock positions of preserved elements with spatial anchoring
        // - Demand texture reconstruction in architectural-visualization language
        const materialName = req.material?.name || "the selected material";
        const materialCategory = req.material?.category || "panels";
        finalPrompt = `Architectural material overlay — renovation preview render.

INPUT 1: the customer's actual room photo. The transparent regions of the mask mark the wall surfaces to be refinished.
INPUT 2: the Product Reference image. This is the exact ${materialCategory} product the customer is considering purchasing (${materialName}).

DIRECTIVES (execute exactly these 4, nothing else):

1. WALL FINISH — Apply the Product Reference material to every transparent (masked) wall region. Reproduce its specific surface: exact base color, exact finish (matte / satin / gloss / metallic), and exact repeating pattern. If the product shows a geometric grid, wood grain, water-drop relief, diamond motif, or panel seam — replicate THAT pattern at a realistic tile scale (each panel ~30 cm wide, repeated side-by-side to cover the wall plane). Do not reinterpret, simplify, or average the texture into a generic surface.

2. PERSPECTIVE + LIGHTING — Warp the material to follow each wall plane's 3D perspective (panels recede toward the vanishing point). Re-light the new material using the room's existing light source: preserve the direction, warmth, and intensity of the incoming light; cast soft shadows where furniture occludes the wall; add subtle highlights where light directly strikes; darken slightly in corners and under shelves.

3. PRESERVE (do not touch) — Every opaque region of the mask remains pixel-identical to the original photo. This includes all furniture (sofas, chairs, tables, beds), cabinetry, television screens, picture frames, mirrors, windows, doors, light fixtures, and the floor and ceiling. Their positions, colors, textures, and shadows are locked.

4. OUTPUT — A single photorealistic image that looks like a real photograph of the same room after a professional installer applied the Product Reference material to the walls. No collages, no split-screens, no labels, no watermarks.`;
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

// =============================================================
// FLUX.1 FILL PROVIDER (via fal.ai) — high-fidelity inpainting
// =============================================================
// WHY THIS EXISTS:
// OpenAI's gpt-image-1/1.5 images.edit does NOT do pixel-level mask
// inpainting — it does a "soft-mask with total image recreation" (confirmed
// by OpenAI staff in community.openai.com/t/1244275). PSNR measured at 13.13
// vs baseline 20.86 (arxiv 2505.05621). Unmasked regions get regenerated,
// which is why furniture gets recolored and the product pattern softens.
//
// FLUX.1 Fill (Black Forest Labs) is a real diffusion inpainter: it
// composites unmasked pixels back through the mask 1:1 by construction.
// Furniture/art/TV preservation becomes a mathematical guarantee, not a
// prompt hope. ~$0.05/render at 1024² via fal.ai, ~5-15s latency.
//
// We pass: the room photo at full source resolution (no downscale to 1024 —
// FLUX accepts arbitrary sizes), the binary wall mask (white=edit), and a
// strong material description from buildOverlayPrompt. Output is a JPEG
// data URI like the OpenAI path returns.

const FAL_FLUX_FILL_URL = "https://fal.run/fal-ai/flux-pro/v1.1/fill";

async function generateOverlayFluxFill(req: OverlayRequest, config: AIConfig, startTime: number): Promise<GenerationResult> {
    if (!config.FAL_API_KEY) {
        throw new Error("fal.ai API key not configured (FAL_API_KEY)");
    }

    const rawImage = req.originalImage ?? (req as any).image;
    if (!rawImage) throw new Error("No image provided for FLUX render");

    // Build the binary mask (white=edit, black=preserve). Falls back to null
    // when there are no walls — caller will route to a different provider.
    const imageBuffer = Buffer.from(cleanBase64(rawImage), "base64");
    if (!req.analysis?.surfaces?.length) {
        throw new Error("FLUX Fill requires analysis surfaces — none provided");
    }
    const { buildBinaryWallMask } = await import("./imageCompositor.js");
    const binaryMask = await buildBinaryWallMask(imageBuffer, req.analysis, req.analysis?.surfaces);
    if (!binaryMask) {
        throw new Error("FLUX Fill: no wall surfaces in analysis — cannot build mask");
    }

    // Material description. Reuse the same prompt builder as the OpenAI path
    // for consistency in voice and rules.
    const { prompt } = buildOverlayPrompt(req);

    // Send the room photo and mask as data URIs. fal.ai accepts both URLs and
    // base64 data URIs; data URI avoids an extra upload round-trip and keeps
    // the request self-contained. Re-encode the room as JPEG to strip any
    // alpha channel (FLUX expects RGB) and keep payload size in check.
    const inputMime = getMimeType(rawImage);
    let roomJpegBuffer: Buffer;
    try {
        roomJpegBuffer = await sharp(imageBuffer).flatten({ background: "#ffffff" }).jpeg({ quality: 95 }).toBuffer();
    } catch {
        // sharp failed — fall back to the raw original.
        roomJpegBuffer = inputMime === "image/jpeg" ? imageBuffer : imageBuffer;
    }
    const roomDataUri = `data:image/jpeg;base64,${roomJpegBuffer.toString("base64")}`;
    const maskDataUri = `data:image/png;base64,${binaryMask.toString("base64")}`;

    // FLUX Fill docs (https://fal.ai/models/fal-ai/flux-pro/v1.1/fill):
    //   image:  source image (URL or data URI)
    //   mask:   white = fill, black = keep (standard diffusion convention)
    //   prompt: description of what should appear in the masked region
    //   strength: 0.0-1.0, how strongly to apply the prompt (1.0 = full replace)
    //   num_images: 1
    //   output_format: "jpeg" | "png"
    //   enable_safety_checker: boolean
    const body = {
        image: roomDataUri,
        mask: maskDataUri,
        prompt,
        strength: 0.98,
        num_images: 1,
        output_format: "jpeg",
        enable_safety_checker: true,
    };

    console.log(`[AI] Calling FLUX.1 Fill via fal.ai (mask size ${binaryMask.length}B, room ${roomJpegBuffer.length}B)...`);

    const response = await fetch(FAL_FLUX_FILL_URL, {
        method: "POST",
        headers: {
            "Authorization": `Key ${config.FAL_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`FLUX Fill HTTP ${response.status}: ${errText.slice(0, 300)}`);
    }

    const data = await response.json() as any;
    // fal.ai response shape: { images: [{ url: "https://..." }], ... }
    // Sometimes also returns base64. Handle both.
    const imageUrl = data?.images?.[0]?.url;
    const imageB64 = data?.images?.[0]?.base64;
    if (!imageUrl && !imageB64) {
        throw new Error(`FLUX Fill: no image in response (keys=${Object.keys(data || {}).join(",")})`);
    }

    // Fetch the URL to embed as data URI (so the rest of the pipeline — which
    // expects base64 — works unchanged).
    let image: string;
    if (imageB64) {
        image = `data:image/jpeg;base64,${imageB64}`;
    } else {
        const imgResp = await fetch(imageUrl);
        if (!imgResp.ok) throw new Error(`FLUX Fill: could not fetch result image (${imgResp.status})`);
        const imgBuf = Buffer.from(await imgResp.arrayBuffer());
        image = `data:image/jpeg;base64,${imgBuf.toString("base64")}`;
    }

    recordSuccess("flux");
    const durationMs = Date.now() - startTime;
    console.log(`[AI] ✅ FLUX.1 Fill success in ${durationMs}ms`);
    return { image, model: "flux-1.1-fill-pro", durationMs, provider: "flux" };
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

    // ─── Pre-rescale to 1086x768 + grid overlay ───────────────────────────
    // gpt-4o vision runs a fixed internal pipeline (per Azure Tech Insider and
    // oranlooney.com/token-encoding analysis): it scales the input to fit a
    // 2048x2048 box, then re-scales so the SHORTEST side = 768px, then tiles
    // into 512x512 chunks. For a typical 4:3 room photo that means the model's
    // internal coordinate space is 1086x768. If we send the image at a different
    // size, the model silently rescales and emits coordinates in its internal
    // space — which we'd then misinterpret as normalized [0,1] floats. Sending
    // the image at 1086x768 makes the model's coords line up with our image
    // 1:1, so the normalized floats it returns are accurate.
    //
    // The 10x10 grid overlay is a documented community technique
    // (community.openai.com/t/671669) that materially improves coordinate
    // precision — the model can anchor "yellow chair at column 2, row 6"
    // instead of estimating abstract floats.
    const analysisImageBase64 = await prepareAnalysisImage(Buffer.from(base64Data, "base64"), mimeType);

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
                                image_url: { url: `data:image/jpeg;base64,${analysisImageBase64}`, detail: "high" },
                            },
                            { type: "text", text: ANALYSIS_PROMPT },
                        ],
                    },
                ],
                // Bumped 3000 → 4000 → 6000 → 8000: the reasoning-first analysis
                // prompt (vanishing point + per-obstacle cue sentences + evidence
                // per surface) needs more output room than a bare JSON dump.
                // The reasoning field is what stops the model from hallucinating
                // coordinates, so starving it defeats the whole point. The strict
                // json_schema also adds overhead vs the bare json_object mode.
                max_tokens: 8000,
                response_format: {
                    type: "json_schema",
                    json_schema: {
                        name: "room_analysis",
                        strict: true,
                        schema: {
                            type: "object",
                            // ORDER MATTERS: fields are emitted in schema order,
                            // so putting observations/reasoning BEFORE surfaces
                            // forces the model to commit to what it sees before
                            // committing to coordinates. This is the documented
                            // Structured Outputs chain-of-thought pattern.
                            additionalProperties: false,
                            properties: {
                                reasoning: {
                                    type: "object",
                                    additionalProperties: false,
                                    properties: {
                                        vanishingPoint: {
                                            type: "array",
                                            items: { type: "number" },
                                            minItems: 2,
                                            maxItems: 2,
                                        },
                                        observedObjects: {
                                            type: "array",
                                            items: { type: "string" },
                                        },
                                        wallPlanes: {
                                            type: "array",
                                            items: { type: "string" },
                                        },
                                        ambiguous: {
                                            type: "array",
                                            items: { type: "string" },
                                        },
                                    },
                                    required: ["vanishingPoint", "observedObjects", "wallPlanes", "ambiguous"],
                                },
                                text: { type: "string" },
                                dimensions: {
                                    type: "object",
                                    additionalProperties: false,
                                    properties: {
                                        width: { type: "number" },
                                        height: { type: "number" },
                                        areaM2: { type: "number" },
                                    },
                                    required: ["width", "height", "areaM2"],
                                },
                                style: { type: "string" },
                                lighting: { type: "string" },
                                suggestedMaterials: {
                                    type: "array",
                                    items: { type: "string" },
                                },
                                surfaces: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        additionalProperties: false,
                                        properties: {
                                            type: {
                                                type: "string",
                                                // Enum prevents invented categories.
                                                enum: [
                                                    "wall", "floor", "ceiling",
                                                    "window", "door", "television", "cabinet",
                                                    "shelf", "picture_frame", "mirror",
                                                    "fireplace", "light_fixture", "radiator",
                                                    "furniture",
                                                ],
                                            },
                                            evidence: { type: "string" },
                                            bounds: {
                                                type: "object",
                                                additionalProperties: false,
                                                properties: {
                                                    x: { type: "number" },
                                                    y: { type: "number" },
                                                    width: { type: "number" },
                                                    height: { type: "number" },
                                                },
                                                required: ["x", "y", "width", "height"],
                                            },
                                            polygon: {
                                                type: "array",
                                                items: {
                                                    type: "array",
                                                    items: { type: "number" },
                                                    minItems: 2,
                                                    maxItems: 2,
                                                },
                                            },
                                            confidence: { type: "number" },
                                        },
                                        required: ["type", "evidence", "bounds", "polygon", "confidence"],
                                    },
                                },
                            },
                            required: ["reasoning", "text", "dimensions", "style", "lighting", "suggestedMaterials", "surfaces"],
                        },
                    },
                },
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

/**
 * Pre-process the room photo for gpt-4o analysis:
 *   1. Resize so the longest side is ~1086px (preserving aspect ratio).
 *      This aligns the model's internal coordinate space with our image, so
 *      the normalized [0,1] floats it returns map directly to image pixels.
 *   2. Overlay a 10x10 grid with row/column numbers. This is a documented
 *      community technique that improves coordinate precision — the model
 *      can anchor observations to grid cells instead of estimating floats.
 *
 * Returns base64-encoded JPEG (always JPEG for consistency — the source mime
 * doesn't matter at this point, we just need bytes the model can read).
 *
 * If sharp fails for any reason, falls back to the raw original image — the
 * prompt still works, just with worse coordinate precision.
 */
async function prepareAnalysisImage(imageBuffer: Buffer, _sourceMime: string): Promise<string> {
    try {
        const TARGET_LONG_SIDE = 1086;
        const meta = await sharp(imageBuffer).metadata();
        const w = meta.width || 0;
        const h = meta.height || 0;
        if (w === 0 || h === 0) {
            return imageBuffer.toString("base64");
        }
        const longest = Math.max(w, h);
        const scale = longest > TARGET_LONG_SIDE ? TARGET_LONG_SIDE / longest : 1;
        const newW = Math.round(w * scale);
        const newH = Math.round(h * scale);

        // 10x10 grid: thin white-translucent lines + row/col numbers at the edges.
        // Cell width/height in pixels of the resized image.
        const cellW = newW / 10;
        const cellH = newH / 10;
        const lines: string[] = [];
        // Vertical lines + column numbers along the top edge.
        for (let i = 1; i < 10; i++) {
            const x = Math.round(i * cellW);
            lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${newH}" stroke="rgba(255,255,255,0.45)" stroke-width="1"/>`);
        }
        // Horizontal lines + row numbers along the left edge.
        for (let i = 1; i < 10; i++) {
            const y = Math.round(i * cellH);
            lines.push(`<line x1="0" y1="${y}" x2="${newW}" y2="${y}" stroke="rgba(255,255,255,0.45)" stroke-width="1"/>`);
        }
        // Numeric labels: column index 0-9 across top, row index 0-9 down left.
        const colLabels: string[] = [];
        for (let c = 0; c < 10; c++) {
            const x = Math.round(c * cellW + cellW / 2);
            colLabels.push(`<text x="${x}" y="14" fill="yellow" font-size="11" font-family="monospace" text-anchor="middle">c${c}</text>`);
        }
        const rowLabels: string[] = [];
        for (let r = 0; r < 10; r++) {
            const y = Math.round(r * cellH + cellH / 2 + 4);
            rowLabels.push(`<text x="6" y="${y}" fill="yellow" font-size="11" font-family="monospace">r${r}</text>`);
        }

        const overlaySvg = Buffer.from(
            `<svg width="${newW}" height="${newH}" xmlns="http://www.w3.org/2000/svg">
                ${lines.join("\n")}
                ${colLabels.join("\n")}
                ${rowLabels.join("\n")}
            </svg>`
        );

        const processed = await sharp(imageBuffer)
            .resize(newW, newH, { fit: "fill" })
            .composite([{ input: overlaySvg, top: 0, left: 0, blend: "over" }])
            .jpeg({ quality: 90 })
            .toBuffer();

        return processed.toString("base64");
    } catch (e) {
        console.warn(`[prepareAnalysisImage] sharp pipeline failed, sending raw image:`, (e as Error)?.message);
        return imageBuffer.toString("base64");
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

    // ─── Provider chain selection ─────────────────────────────────────
    // For inpaint mode with surfaces + a fal.ai key, FLUX.1 Fill is preferred.
    // It is a real diffusion inpainter — unmasked pixels are composited back
    // 1:1, which solves the gpt-image-1.5 "soft-mask full regen" problem
    // (OpenAI staff confirmed limitation: community.openai.com/t/1244275).
    // If FLUX is unavailable (no key, not inpaint mode, no surfaces), fall
    // back to the gpt-image-1.5 path which always works but softens texture.
    const isInpaint = (req as any).mode === "inpaint" && !!req.analysis?.surfaces?.length;
    const wantFlux = isInpaint && !!config.FAL_API_KEY;
    const providerChain: AIProvider[] = wantFlux
        ? ["flux", "openai", "generic"]
        : ["openai", "generic"];

    console.log(`[AI] Image generation provider chain: ${providerChain.join(" → ")} (inpaint=${isInpaint}, flux_enabled=${!!config.FAL_API_KEY})`);

    for (const provider of providerChain) {
        try {
            switch (provider) {
                case "flux":
                    if (!config.FAL_API_KEY) {
                        errors.push("FLUX: No FAL_API_KEY configured");
                        continue;
                    }
                    return await generateOverlayFluxFill(req, config, start);

                case "openai":
                    if (!config.OPENAI_API_KEY) {
                        errors.push("OpenAI: No API key configured");
                        continue;
                    }
                    return await generateOverlayOpenAI(req, config, start);

                case "generic":
                    return await generateGenericOverlay(req);

                default:
                    errors.push(`${provider}: not in image-generation chain`);
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
