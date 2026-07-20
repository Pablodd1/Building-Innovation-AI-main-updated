# AI Compositor & Renderer Notes

This document contains the initial instructions, errors encountered, and the latest logic used for the AI rendering engine. It was created to assist in migrating or handing over the project.

## Models in Use
- **Room Analysis (Object/Wall Detection):** `gemini-3.5-flash` (Primary), `gemini-2.5-flash` (Fallback).
- **Image Generation (Fallback):** `imagen-3.0-generate-002`, `gemini-2.5-flash`.
- **Primary Compositor:** Local Node.js `sharp` library (used for 99% of renders to ensure exact texture mapping).

## The Original Issue (Invisible Textures & Blocky Walls)
1. **Invisible Textures:** The product images (e.g., white PVC panels) were photographed on white backgrounds. When the compositor used the `multiply` blend mode to apply shadows, white panels became entirely transparent against light walls.
2. **Blocky Outlines:** The system was using a rudimentary "Luminance Threshold" to try and guess where furniture was (by assuming furniture was darker than the wall). This caused shadows on the wall to be falsely detected as furniture, cutting the wall up into ugly, blocky black-and-white shapes.

## The Fixes Implemented
1. **Texture Auto-Cropping:** The compositor now uses `sharp` to automatically crop out the center 20% of the product image, throwing away the white backgrounds and extracting the pure texture.
2. **Vector Bounding Boxes (AI):** The thresholding was removed. We now strictly use the `gemini-3.5-flash` model to analyze the room and draw precise bounding boxes around `furniture`, `windows`, `doors`, `cabinets`, and `picture_frames`. The compositor then cuts these boxes out of the mask, ensuring the original furniture remains untouched.
3. **Realistic Tiling:** The texture tiling logic was fixed so that the cropped texture strip is scaled to match the wall's height while perfectly preserving its physical aspect ratio. This prevents the blurry, horizontal stretching effect.

## The AI Prompts
### Room Analysis Prompt
Used to detect the walls and obstacles. We updated this to be extremely aggressive about finding cabinets and wall-mounted objects because Gemini was previously missing them.

\`\`\`text
You are a Senior Architectural Interior Analyst. Analyze this photo of an interior/exterior space.

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
6. For dimensions: estimate the room's width and height in CENTIMETERS, and calculate areaM2 as (width * height) / 10000.
\`\`\`

## Current Status & Known Issues
- The backend API (`/api/ai/generate-overlay`) successfully returns high-quality composites when tested directly.
- If the AI (Gemini) completely misses an object (like a white cabinet on a white wall), the compositor will paint over it because it relies entirely on the AI's bounding boxes.
- Dark materials (like FOAM BOARD BURDEO) will render very dark because we apply a \`multiply\` blend of the wall's original shadows over the texture.

## Key Files to Review
- \`server/services/imageCompositor.ts\`: Contains the Sharp logic, cropping, and vector masking.
- \`server/services/aiProviders.ts\`: Contains the Gemini model integration and prompts.
