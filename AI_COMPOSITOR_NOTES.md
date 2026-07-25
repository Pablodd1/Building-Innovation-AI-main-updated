# AI Compositor & Renderer Notes

## Current Architecture (July 2026)

### Models in Use
- **Room Analysis:** OpenAI `gpt-4o` (primary), `gpt-4o-mini` (fallback)
- **Image Render (compositor):** Local Node.js `sharp` library
- **Image Render (inpaint):** OpenAI `gpt-image-1.5` / `gpt-image-1` / `gpt-image-1-mini`
- **Image Render (FLUX):** `flux-1.1-fill-pro` via fal.ai (when `FAL_API_KEY` set)

### Provider Status
- **OpenAI:** ACTIVE — sole provider for analysis and inpaint renders
- **FLUX.1 Fill:** ACTIVE when `FAL_API_KEY` is configured (preferred for inpaint)
- **Gemini:** DISABLED — no API key configured, code unreachable
- **OpenRouter:** DISABLED — no API key configured

## The Original Issue (Invisible Textures & Blocky Walls)
1. **Invisible Textures:** White PVC panels on white backgrounds became transparent with `multiply` blend.
2. **Blocky Outlines:** Luminance threshold falsely detected shadows as furniture, cutting walls into blocky shapes.

## Fixes Implemented
1. **Texture Auto-Cropping:** `sharp` crops center 20% of product image, removing white backgrounds.
2. **Vector Bounding Boxes (AI):** `gpt-4o` vision returns precise 4-point polygons for walls and bounding boxes for obstacles. No more thresholding.
3. **Realistic Tiling:** Texture strip scaled to wall height while preserving aspect ratio.
4. **Grid Overlay:** 10x10 calibration grid drawn on analysis image for coordinate precision.
5. **Reasoning-First Schema:** Analysis prompt forces model to list observed objects before writing coordinates.

## The AI Prompts

### Room Analysis Prompt
See `ANALYSIS_PROMPT` in `server/services/aiProviders.ts` (lines 520-633). Key features:
- 4-point polygon walls (rejects rectangles)
- Mandatory obstacle detection: furniture, TV, cabinets, picture frames, windows, doors
- Anti-hallucination contract with evidence strings
- 10x10 grid overlay for calibration
- Reasoning-first output schema

### Render Prompt
See `buildOverlayPrompt` in `server/services/aiProviders.ts` (lines 468-518). Key rules:
- EXACT texture, pattern, color, scale from Product Reference image
- PRESERVE FOREGROUND: furniture, people, plants, windows, wall-mounted items, art, TVs, doors
- Anti-hallucination: no new/removed objects, no geometry/lighting changes
- Interior + exterior supported

## Product Image Flow
1. Frontend sends `material.imageUrl` (raw Google Drive URL)
2. Backend `getImageBase64()` fetches full-resolution image server-side
3. Image passed as base64 to OpenAI/FLUX alongside room photo
4. **Explicit error thrown** if product image fails to load (no silent text-only fallback)

## Key Files
- `server/services/aiProviders.ts` — OpenAI/FLUX integration, prompts, failover
- `server/services/imageCompositor.ts` — Sharp compositor, polygon masking, tiling
- `server/index.ts` — API routes, auth, quota, admin endpoints

## Known Issues
- Dark materials render very dark due to `multiply` blend of original shadows
- If AI misses an obstacle (white cabinet on white wall), compositor paints over it
- 33s render time for inpaint mode — consider FLUX.1 Fill for 5-15s latency
