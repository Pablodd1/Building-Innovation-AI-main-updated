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
}

export interface GenerationState {
  isGenerating: boolean;
  isAnalyzing: boolean; // Subtle loading state for text analysis
  error: string | null;
  resultImage: string | null; // Base64
  resultVideo: string | null; // URL
  analysis: string | null; // Text
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
