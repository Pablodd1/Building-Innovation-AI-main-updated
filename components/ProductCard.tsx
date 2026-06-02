import React, { memo } from "react";
import { Material, AppView } from "../../types";

interface ProductCardProps {
    material: Material;
    lang: "en" | "es";
    proxyImageUrl: (url: string) => string;
    handleImageError: (e: React.SyntheticEvent<HTMLImageElement>) => void;
    onSelect: (material: Material) => void;
    onAddToCart: (material: Material) => void;
    onEstimate: (material: Material) => void;
}

const ProductCardComponent: React.FC<ProductCardProps> = ({
    material,
    lang,
    proxyImageUrl,
    handleImageError,
    onSelect,
    onAddToCart,
    onEstimate,
}) => {
    return (
        <div className="group relative aspect-square rounded-2xl overflow-hidden bg-gray-200 border border-gray-300 hover:border-blue-500 hover:shadow-2xl hover:shadow-blue-900/20 transition-all">
            <button
                onClick={() => onSelect(material)}
                className="absolute inset-0 w-full h-full text-left"
            >
                <img
                    src={proxyImageUrl(material.imageUrl)}
                    data-original-src={material._fallbackImageUrl || proxyImageUrl(material.imageUrl)}
                    alt={material.name}
                    onError={handleImageError}
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent p-2 flex flex-col justify-end">
                    <div className="text-[8px] font-bold text-blue-400 uppercase tracking-wider mb-0.5">
                        {material.category}
                    </div>
                    <div className="text-gray-700 text-[11px] font-bold leading-tight mb-0.5 line-clamp-2">
                        {material.name}
                    </div>
                    <div className="text-[8px] text-gray-500">
                        {material.dimensions.width}x{material.dimensions.length}cm
                    </div>
                </div>
            </button>
            {/* Add to Cart button */}
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onAddToCart(material);
                }}
                className="absolute bottom-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold px-2.5 py-1.5 rounded-full shadow-lg flex items-center gap-1"
                title={lang === "es" ? "Añadir al carrito" : "Add to cart"}
            >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
                </svg>
                +
            </button>
            {/* Estimate button */}
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onEstimate(material);
                }}
                className="absolute bottom-2 left-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity bg-green-600 hover:bg-green-500 text-white text-[10px] font-bold px-2.5 py-1.5 rounded-full shadow-lg flex items-center gap-1"
                title={lang === "es" ? "Cotizar" : "Estimate"}
            >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
                {lang === "es" ? "Cotizar" : "Estimate"}
            </button>
        </div>
    );
};

export const ProductCard = memo(ProductCardComponent);
