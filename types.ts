export interface MaterialDimensions {
  width: number; // in cm
  length: number; // in cm
  thickness: number; // in mm
}

export interface MaterialPricing {
  pricePerUnit: number;
  priceContractor?: number;
  currency: string;
  unitLabel: string; // e.g., "Panel", "Box", "m2", "Roll"
  itemsPerBox?: number; // If sold by box
}

export interface User {
    id: number;
    name: string;
    email: string;
    role: string;
    tier: string;
    generations_used: number;
    photoURL?: string; // Profile avatar URL
}

export interface TechnicalSpecs {
  patternRepeat?: number; // in cm (for wallpaper/rolls)
  recommendedWaste?: number; // decimal (e.g. 0.05 for 5%)
  installationType?: "ROLL" | "TILE" | "LINEAR";
  finish?: "Matte" | "Gloss" | "Satin" | "Textured";
}

export interface Material {
  id: string; // MongoDB _id style
  refCode: string; // SKU
  name: string;
  description: string;
  imageUrl: string; // Unified: Used for both Thumbnail and AI Reference
  category: string; // e.g., "Flooring"
  subcategory?: string; // e.g., "SPC", "Laminate", "Porcelain"
  usage: "Interior" | "Exterior";
  dimensions?: MaterialDimensions;
  pricing: MaterialPricing;
  specs?: TechnicalSpecs;
  promptModifier: string; // AI visual description
}

export enum AppView {
  LOGIN = "LOGIN",
  LANDING = "LANDING",
  ADMIN = "ADMIN",
  GALLERY = "GALLERY",
  CAMERA = "CAMERA",
  EDITOR = "EDITOR",
  ESTIMATION = "ESTIMATION",
  CART = "CART",
  PRIVACY = "PRIVACY",
  TERMS = "TERMS",
}

export interface RoomDimensions {
  width: number;  // in cm
  height: number; // in cm
  areaM2: number; // in square meters
}

export interface RoomAnalysisResult {
  text: string;           // Human-readable analysis text
  dimensions?: RoomDimensions; // Estimated room dimensions from AI
  surfaces?: any[];       // Detected surfaces for compositing
  style?: string;         // Detected design style
  lighting?: string;      // Detected lighting condition
  suggestedMaterials?: string[]; // Suggested materials
}

export interface GenerationState {
  isGenerating: boolean;
  isAnalyzing: boolean; // Subtle loading state for text analysis
  isRealisticGenerating: boolean; // Separate flag for the slower OpenAI inpaint path
  loadingStage: 'idle' | 'analyzing' | 'rendering' | 'enhancing'; // Drives the multi-stage overlay
  error: string | null;
  resultImage: string | null; // Base64
  resultVideo: string | null; // URL
  analysis: RoomAnalysisResult | null; // Structured analysis with dimensions
  materialProbe: string | null; // 3D Sphere Preview
}

export interface CartItem {
  id: string;
  material: Material;
  quantity: number;
  totalCost: number;
  dimensions: { width: number; height: number };
  timestamp: number;
}

export interface Contractor {
  id: string;
  name: string;
  phone: string;
  email: string;
  region: string;
  address?: string; // Colombian street address
  lat?: number; // Latitude for proximity checks
  lon?: number; // Longitude for proximity checks
  laborRatePerSqm?: number; // Labor cost per square meter
  laborRatePerLinear?: number; // Labor cost per linear meter
  laborRatePerPiece?: number; // Labor cost per piece (for rolls)
}

export type Language = "en" | "es";
export type RegionUnit = "latam" | "usa";

export type LightingCondition = "NATURAL" | "SUNSET" | "NIGHT_LUXURY";
export type ViewAngle = "PERSPECTIVE" | "TOP_DOWN" | "WIDE_ANGLE" | "ISOMETRIC";

export interface RenderOptions {
  lighting: LightingCondition;
  viewAngle: ViewAngle;
  declutter: boolean;
}
