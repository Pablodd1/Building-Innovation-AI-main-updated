import { Material, RenderOptions, RoomAnalysisResult } from "../types";

// =============================================================
// SERVER-PROXIED AI GENERATION
// All AI calls go through the server — clients NEVER see the API key
// =============================================================

const getErrorMessage = (error: any): string => {
    if (typeof error === "string") return error;
    if (error?.error?.message) return error.error.message;
    if (error?.response?.data?.error?.message) return error.response.data.error.message;
    if (error?.message) return error.message;
    return JSON.stringify(error);
};

// --- Room Analysis ---

export const generateRoomAnalysis = async (
    imageBase64: string,
    userId?: number,
    lang: string = "en"
): Promise<RoomAnalysisResult> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000); // 45s timeout

    try {
        const res = await fetch("/api/ai/analyze-room", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: imageBase64, userId, lang }),
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "Server error" }));
            throw new Error(err.error || err.message || "Analysis failed");
        }

        const data = await res.json();
        return {
            text: data.analysis || "Could not analyze the room.",
            dimensions: data.dimensions,
            surfaces: data.surfaces,
            style: data.style,
            lighting: data.lighting,
            suggestedMaterials: data.suggestedMaterials,
        };
    } catch (error: any) {
        clearTimeout(timeout);
        if (error.name === "AbortError") {
            throw new Error("Analysis timed out after 45s.");
        }
        throw error;
    }
};

// --- Material Overlay Generation ---

export const generateMaterialOverlay = async (
    originalImageBase64: string,
    material: Material,
    userInstruction: string,
    renderOptions?: RenderOptions,
    lang?: string,
    userId?: number,
    analysis?: any,
    mode?: "compositor" | "inpaint"
): Promise<string> => {
    const controller = new AbortController();
    // Inpaint mode calls OpenAI gpt-image which can take 30-60s — extend the
    // timeout accordingly so we don't abort mid-render. Compositor stays fast.
    const timeoutMs = mode === "inpaint" ? 120000 : 60000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch("/api/ai/generate-overlay", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                originalImage: originalImageBase64,
                material,
                userInstruction,
                renderOptions,
                lang,
                userId,
                analysis,
                mode,
            }),
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "Server error" }));
            throw new Error(err.error || err.message || "Generation failed");
        }

        const data = await res.json();
        if (!data.image) throw new Error("No image returned from server");
        return data.image;
    } catch (error: any) {
        clearTimeout(timeout);
        if (error.name === "AbortError") {
            const waitMsg = mode === "inpaint" ? "2 minutes" : "60 seconds";
            throw new Error(`Render timed out after ${waitMsg}. Try a smaller image or use Generate View instead.`);
        }
        throw error;
    }
};

// --- Video Generation (still client-side, uses same server key) ---

export const generateCinematicVideo = async (
    imageBase64: string,
    prompt: string,
    userId?: number
): Promise<string | null> => {
    // Video generation requires Veo which may need different handling
    // For now, return null — server-side video generation can be added later
    console.warn("Video generation not yet implemented in server proxy");
    return null;
};

// --- Stub for generateMaterialProbe ---

export const generateMaterialProbe = async (): Promise<string | null> => {
    return null;
};
