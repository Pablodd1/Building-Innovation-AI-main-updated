
import { GoogleGenAI } from "@google/genai";
import { Material, RenderOptions } from "../types";

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
    if (error?.error?.message) return error.error.message;
    if (error?.response?.data?.error?.message) return error.response.data.error.message;
    if (error?.message) return error.message;
    return JSON.stringify(error);
};

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

const getApiKey = (): string => {
    const customKey = localStorage.getItem('custom_api_key');
    if (customKey && customKey.trim().length > 0) return customKey.trim();
    if (process.env.API_KEY) return process.env.API_KEY;
    return 'AIzaSyAenMod0hhqrp25lxYIXbXVIL87zu_Fo5A';
};

export const generateRoomAnalysis = async (imageBase64: string): Promise<string> => {
    const apiKey = getApiKey();
    const ai = new GoogleGenAI({ apiKey });

    const base64Data = cleanBase64(imageBase64);
    const mimeType = getMimeType(imageBase64);

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
            parts: [
                { inlineData: { data: base64Data, mimeType: mimeType } },
                { text: "Analyze this interior/exterior space. Identify style and lighting. Suggest materials." }
            ]
        }
    });

    return response.text || "Could not analyze the room.";
};

export const generateCinematicVideo = async (imageBase64: string, prompt: string): Promise<string | null> => {
    const apiKey = getApiKey();
    const ai = new GoogleGenAI({ apiKey });

    const base64Data = cleanBase64(imageBase64);
    const mimeType = getMimeType(imageBase64);

    const generateWithModel = async (modelName: string) => {
        let operation = await ai.models.generateVideos({
            model: modelName, 
            image: { imageBytes: base64Data, mimeType: mimeType },
            prompt: `Cinematic slow pan camera movement, ${prompt}, 4k, photorealistic`,
            config: { numberOfVideos: 1, resolution: '720p', aspectRatio: '16:9' }
        });

        while (!operation.done) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            operation = await ai.operations.getVideosOperation({ operation: operation });
        }

        return operation.response?.generatedVideos?.[0]?.video?.uri;
    };

    try {
        return await generateWithModel('veo-3.1-generate-preview');
    } catch (error) {
        try {
            return await generateWithModel('veo-3.1-fast-generate-preview');
        } catch (fallbackError) {
             console.warn("Veo Video Generation unavailable:", getErrorMessage(fallbackError));
             return null;
        }
    }
};

export const generateMaterialProbe = async (material: Material): Promise<string> => {
    const apiKey = getApiKey();
    const ai = new GoogleGenAI({ apiKey });

    // Use specific details for the probe to ensure the user sees accurate texture
    const prompt = `
        Create a photorealistic 3D rendering of a material sphere.

        PRODUCT DETAILS:
        Name: "${material.name}"
        RefCode: "${material.refCode}"
        Category: "${material.category} - ${material.subcategory || ''}"
        Finish: "${material.specs?.finish || 'Standard'}"

        Visual Description: "${material.promptModifier}"

        Setup: Sphere on white studio background. Softbox lighting. 8k raytracing.
        Ensure physically accurate roughness and reflectivity based on the Finish type.
    `;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3-pro-image-preview',
            contents: { parts: [{ text: prompt }] },
            config: { imageConfig: { aspectRatio: "1:1", imageSize: "1K" } }
        });
        return extractImage(response);
    } catch (error) {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: { parts: [{ text: prompt }] }
        });
        return extractImage(response);
    }
};

export const generateMaterialOverlay = async (
  originalImageBase64: string,
  material: Material,
  userInstruction: string,
  options?: RenderOptions
): Promise<string> => {

  const apiKey = getApiKey();
  const ai = new GoogleGenAI({ apiKey });
  const base64Data = cleanBase64(originalImageBase64);
  const mimeType = getMimeType(originalImageBase64);

  let lightingPrompt = "LIGHTING: Natural bright daylight. Preserve original light direction and shadow falloff.";
  if (options?.lighting === 'SUNSET') lightingPrompt = "LIGHTING: Golden Hour / Sunset. Warm hues. Long, soft shadows.";
  else if (options?.lighting === 'NIGHT_LUXURY') lightingPrompt = "LIGHTING: Night time luxury. Artificial warm ambient lighting. Spotlight accents.";

  let viewPrompt = "VIEWPOINT: Maintain original camera perspective and focal length.";
  if (options?.viewAngle === 'TOP_DOWN') viewPrompt = "VIEWPOINT: Top-down floorplan view. Orthographic projection.";
  else if (options?.viewAngle === 'ISOMETRIC') viewPrompt = "VIEWPOINT: ARCHITECTURAL 3D ISOMETRIC CUTAWAY. Miniature diorama style. 30-degree angle.";

  let declutterPrompt = options?.declutter ? "ACTION: REMOVE ALL FURNITURE. Show empty architectural shell." : "ACTION: Keep existing furniture layouts.";

  // Finish Physics Mapping
  const finish = material.specs?.finish || 'Matte';
  const finishPrompts: Record<string, string> = {
      'Gloss': "Finish: High Gloss. Physics: Low roughness (0.1), high specular reflection. Interaction: Reflects environment/windows clearly.",
      'Matte': "Finish: Flat Matte. Physics: High roughness (0.9), diffuse scattering. Interaction: No specular highlights, absorbs light.",
      'Satin': "Finish: Satin/Semi-Gloss. Physics: Medium roughness (0.4). Interaction: Soft, blurred reflections.",
      'Textured': "Finish: Heavy Texture. Physics: Normal mapping required. Interaction: Strong self-shadowing and ambient occlusion in crevices."
  };
  const selectedFinish = finishPrompts[finish] || finishPrompts['Matte'];

  // Enhanced Physics-based Rendering Instructions
  const textureInstruction = `
    TARGET MATERIAL:
    - Name: ${material.name}
    - Type: ${material.category} (${material.subcategory || 'General'})
    - Visual Description: ${material.promptModifier}
    - Physical Properties: ${selectedFinish}
    - Scale Reference: Plank/Tile size is approx ${material.dimensions.width}cm x ${material.dimensions.length}cm.

    CRITICAL: The applied material must match the description exactly in terms of scale, grain, and reflectivity.
  `;

  let finalPrompt = `
      Act as a high-end architectural visualizer using a physically based rendering (PBR) engine.

      TASK:
      Contextually identify the surface corresponding to the category '${material.category}' (e.g., if Flooring -> Floor, if Wallpaper -> Walls) and replace its material.

      ${textureInstruction}

      GEOMETRY & MAPPING RULES:
      1. Conformal Mapping: Ensure the texture wraps correctly around non-flat geometry (curved walls, furniture edges, moldings, uneven floors).
      2. Perspective: Strictly adhere to the image's vanishing points. Texture density must increase naturally with depth.
      3. Displacement: If the material is 'Textured', simulate depth displacement so it doesn't look like a flat sticker.

      SCENE SETTINGS:
      ${lightingPrompt}
      ${viewPrompt}
      ${declutterPrompt}

      USER OVERRIDE: 
      ${userInstruction}

      OUTPUT QUALITY:
      Photorealistic 8k, highly detailed. No artifacts. Seamless blending with existing baseboards/edges.
    `;

  const contents = {
    parts: [
        { inlineData: { data: base64Data, mimeType: mimeType } },
        { text: finalPrompt }
    ]
  };

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: contents,
      config: { imageConfig: { imageSize: '4K' } }
    });
    return extractImage(response);
  } catch (error) {
    console.warn("Pro Model failed, fallback to Flash.");
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: contents
    });
    return extractImage(response);
  }
};