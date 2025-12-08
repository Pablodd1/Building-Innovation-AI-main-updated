
import { GoogleGenAI } from "@google/genai";
import { Material } from "../types";

// Helper to strip the data:image/png;base64, prefix
const cleanBase64 = (dataURI: string) => {
  return dataURI.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");
};

const getMimeType = (dataURI: string) => {
  const match = dataURI.match(/^data:(image\/\w+);base64,/);
  return match ? match[1] : 'image/jpeg';
};

// Robust Error Message Extractor
const getErrorMessage = (error: any): string => {
    if (typeof error === 'string') return error;
    // Handle nested API error objects
    if (error?.error?.message) return error.error.message;
    if (error?.response?.data?.error?.message) return error.response.data.error.message;
    if (error?.message) return error.message;
    return JSON.stringify(error);
};

// Helper to extract image from response parts
const extractImage = (response: any): string => {
    if (response.candidates && response.candidates[0].content.parts) {
        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
                return `data:image/png;base64,${part.inlineData.data}`;
            }
        }
    }
    throw new Error("No image generated in the response.");
};

// Cached API key from backend
let cachedApiKey: string | null = null;

// Helper to get API Key (Custom > Backend)
const getApiKey = async (): Promise<string> => {
    const customKey = localStorage.getItem('custom_api_key');
    if (customKey && customKey.trim().length > 0) {
        return customKey.trim();
    }
    
    // Return cached key if available
    if (cachedApiKey) {
        return cachedApiKey;
    }
    
    // Fetch from backend
    try {
        const response = await fetch('/api/gemini-key');
        if (response.ok) {
            const data = await response.json();
            if (data.key) {
                cachedApiKey = data.key;
                return data.key;
            }
        }
    } catch (error) {
        console.error('Failed to fetch API key from backend:', error);
    }
    
    throw new Error("API Key missing. Please configure it in Settings.");
};

export const generateRoomAnalysis = async (
    imageBase64: string
): Promise<string> => {
    const apiKey = await getApiKey();
    const ai = new GoogleGenAI({ apiKey });
    
    const base64Data = cleanBase64(imageBase64);
    const mimeType = getMimeType(imageBase64);

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
            parts: [
                { inlineData: { data: base64Data, mimeType: mimeType } },
                { text: "Analyze this interior/exterior space as a Senior Architect. 1) Identify the Design Style (e.g., Minimalist, Industrial). 2) Analyze the Lighting conditions. 3) Suggest what type of materials (Wood, Stone, Metal) would best suit this specific room geometry and lighting. Keep it brief and professional (max 100 words)." }
            ]
        }
    });

    return response.text || "Could not analyze the room.";
};

export const generateCinematicVideo = async (
    imageBase64: string,
    prompt: string
): Promise<string | null> => {
    const apiKey = await getApiKey();
    const ai = new GoogleGenAI({ apiKey });
    
    const base64Data = cleanBase64(imageBase64);
    const mimeType = getMimeType(imageBase64);

    // Helper to attempt generation with a specific model
    const generateWithModel = async (modelName: string) => {
        let operation = await ai.models.generateVideos({
            model: modelName, 
            image: {
                imageBytes: base64Data,
                mimeType: mimeType
            },
            prompt: `Cinematic slow pan camera movement showing this room, ${prompt}, 4k, photorealistic, architectural visualization`,
            config: {
                numberOfVideos: 1,
                resolution: '720p',
                aspectRatio: '16:9' 
            }
        });

        // Polling Loop
        while (!operation.done) {
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s
            operation = await ai.operations.getVideosOperation({ operation: operation });
        }
        
        return operation.response?.generatedVideos?.[0]?.video?.uri;
    };

    try {
        // Attempt 1: Try Standard Preview (Higher Quality)
        return await generateWithModel('veo-3.1-generate-preview');
    } catch (error: any) {
        // Silent catch for first attempt, proceed to fallback
        try {
            // Attempt 2: Try Fast Preview (Fallback)
            return await generateWithModel('veo-3.1-fast-generate-preview');
        } catch (fallbackError: any) {
             const errorMsg = getErrorMessage(fallbackError);
             const cleanMsg = errorMsg.toLowerCase();

             // Don't throw error, just log and return null to indicate unavailability
             console.warn("Veo Video Generation unavailable:", errorMsg);
             return null;
        }
    }
};

export const generateMaterialOverlay = async (
  originalImageBase64: string,
  material: Material,
  userInstruction: string
): Promise<string> => {
  
  const apiKey = await getApiKey();
  const ai = new GoogleGenAI({ apiKey });
  
  const base64Data = cleanBase64(originalImageBase64);
  const mimeType = getMimeType(originalImageBase64);

  const isFurniture = material.usage === 'Furniture' || material.category === 'Muebles';

  // Construct a robust prompt with Chain-of-Thought for smart analysis
  let finalPrompt = '';

  if (isFurniture) {
    finalPrompt = `
      Act as a world-class professional virtual stager and interior designer.
      
      Input: An image of a room (Interiors) or space (Exterior).
      Task: Realistically place the following furniture item into the scene.
      
      --- OBJECT SPECIFICATIONS ---
      Name: "${material.name}"
      Description: "${material.description}"
      Visual Style: "${material.promptModifier}"
      
      --- USER INSTRUCTIONS ---
      "${userInstruction}"
      
      --- STEP-BY-STEP EXECUTION ---
      
      PHASE 1: DEEP SPATIAL & CONTEXT ANALYSIS
      - Analyze the image to identify the 3D structure of the room, including depth planes (foreground, midground, background).
      - Identify existing furniture and layout to find logical placement zones that respect flow and function.
      - Analyze perspective cues (vanishing points, horizon line) to ensure the object sits naturally in the 3D space.
      - Identify the primary light source direction, intensity, and color temperature.
      
      PHASE 2: INTELLIGENT PLACEMENT & COMPOSITION
      - Interpret the "User Instructions" specifically regarding depth (e.g., "in the corner" implies background, "front left" implies foreground).
      - If no specific location is asked, place the item in the most aesthetically pleasing and functional open space.
      - SCALE: Ensure the object is sized correctly relative to surrounding objects (chairs, windows, doors).
      - OCCLUSION: If the object is placed behind existing furniture, ensure it is partially hidden. If placed in front, ensure it covers background elements appropriately.
      
      PHASE 3: PHOTOREALISTIC RENDERING
      - Generate the object with hyper-realistic textures (fabric weaves, wood grain, reflections).
      - LIGHTING INTEGRATION: Match the room's lighting. Cast realistic shadows on the floor and nearby walls/objects based on the light source.
      - COLOR GRADING: Match the white balance and exposure of the original image.
      
      Output ONLY the final modified image.
    `;
  } else {
    finalPrompt = `
      Act as a specialized architectural visualization AI.
      
      Input: An image of a room or building.
      Task: Apply a specific material to the relevant architectural surfaces (e.g., walls, floors, decks) while preserving the scene's geometry and lighting.
      
      --- MATERIAL SPECIFICATIONS ---
      Type: "${material.category}"
      Description: "${material.description}"
      Texture/Look: "${material.promptModifier}"
      
      --- USER INSTRUCTIONS ---
      "${userInstruction}"
      
      --- STEP-BY-STEP EXECUTION ---
      
      PHASE 1: SCENE ANALYSIS
      - Identify the surfaces that match the material type (e.g., if material is "Flooring", identify the floor; if "Wall Covering", identify walls).
      - Analyze the lighting: where are the highlights and where are the deep shadows?
      - DETECT OCCLUSIONS: Identify objects standing IN FRONT of the target surface (furniture, people, plants, rugs).
      
      PHASE 2: APPLICATION & MASKING
      - Apply the new material texture to the target surface.
      - CRITICAL: Do NOT paint over the occluding objects (furniture, people). The new material must go BEHIND/UNDER them.
      - If the "User Instruction" asks to remove objects, prioritize that over preservation.
      
      PHASE 3: INTEGRATION & TEXTURE REFINEMENT
      - Render the material with high resolution texture mapping, ensuring fine details (grout lines, wood grain, stone veins) are crisp.
      - Adjust perspective of the texture to match the room's vanishing points.
      - Re-apply the original shadows and highlights onto the new material (multiply/overlay logic).
      - Ensure the edges are clean.
      
      Output ONLY the final visual result with high photorealism.
    `;
  }

  const contents = {
    parts: [
        {
            inlineData: {
                data: base64Data,
                mimeType: mimeType
            }
        },
        {
            text: finalPrompt
        }
    ]
  };

  try {
    // Attempt 1: Try Pro Model (4K)
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: contents,
      config: {
        imageConfig: {
          imageSize: '4K'
        }
      }
    });
    return extractImage(response);

  } catch (error: any) {
    console.warn("Pro Model generation failed, falling back to Flash model.");

    // Attempt 2: Fallback to Flash Model (Standard Resolution)
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: contents
        });
        return extractImage(response);
    } catch (fallbackError: any) {
        // Use robust error extractor for final failure
        const msg = getErrorMessage(fallbackError);
        throw new Error(`Generation failed: ${msg}`);
    }
  }
};
