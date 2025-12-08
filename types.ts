
export interface MaterialDimensions {
  width: number; // in cm
  length: number; // in cm
  thickness: number; // in mm
}

export interface MaterialPricing {
  pricePerUnit: number;
  currency: string;
  unitLabel: string; // e.g., "Panel", "Box"
  itemsPerBox?: number; // If sold by box
}

export interface TechnicalSpecs {
  patternRepeat?: number; // in cm (for wallpaper/rolls)
  recommendedWaste?: number; // decimal (e.g. 0.05 for 5%)
  installationType?: 'ROLL' | 'TILE' | 'LINEAR' | 'UNIT';
}

export interface Material {
  id: string;
  refCode: string;
  name: string;
  description: string;
  thumbnailUrl: string;
  exampleImageUrl?: string;
  promptModifier: string;
  category: string;
  usage: 'Interior' | 'Exterior' | 'Furniture';
  dimensions: MaterialDimensions;
  pricing: MaterialPricing;
  specs?: TechnicalSpecs; // New field for calculation engine
}

export enum AppView {
  LOGIN = 'LOGIN',
  LANDING = 'LANDING',
  ADMIN = 'ADMIN',
  GALLERY = 'GALLERY',
  CAMERA = 'CAMERA',
  EDITOR = 'EDITOR',
  ESTIMATION = 'ESTIMATION',
  CART = 'CART'
}

export interface GenerationState {
  isGenerating: boolean;
  error: string | null;
  resultImage: string | null; // Base64
  resultVideo: string | null; // URL
  analysis: string | null; // Text
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
}

export type Language = 'en' | 'es';
