import React, { useState, useRef, useCallback, useEffect } from 'react';
import { hapticLight } from '../utils/haptics';

interface ImageComparatorProps {
    beforeImage: string;
    afterImage: string;
    materialThumbnail?: string;
}

export const ImageComparator: React.FC<ImageComparatorProps> = ({
    beforeImage,
    afterImage,
    materialThumbnail,
}) => {
    const [sliderPos, setSliderPos] = useState(50); // percentage
    const [isDragging, setIsDragging] = useState(false);
    const [isHoldingOriginal, setIsHoldingOriginal] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const getClientX = (e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent): number => {
        if ('touches' in e) return e.touches[0]?.clientX ?? 0;
        return e.clientX;
    };

    const updatePosition = useCallback(
        (clientX: number) => {
            if (!containerRef.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            const pos = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
            setSliderPos(pos);
        },
        [],
    );

    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        hapticLight();
        setIsDragging(true);
    };

    const handleTouchStart = (e: React.TouchEvent) => {
        e.preventDefault();
        hapticLight();
        setIsDragging(true);
    };

    useEffect(() => {
        if (!isDragging) return;

        const handleMove = (e: MouseEvent | TouchEvent) => {
            updatePosition(getClientX(e));
        };

        const handleUp = () => setIsDragging(false);

        document.addEventListener('mousemove', handleMove);
        document.addEventListener('mouseup', handleUp);
        document.addEventListener('touchmove', handleMove, { passive: true });
        document.addEventListener('touchend', handleUp);

        return () => {
            document.removeEventListener('mousemove', handleMove);
            document.removeEventListener('mouseup', handleUp);
            document.removeEventListener('touchmove', handleMove);
            document.removeEventListener('touchend', handleUp);
        };
    }, [isDragging, updatePosition]);

    // Click on container moves slider
    const handleContainerClick = (e: React.MouseEvent) => {
        if (isDragging) return;
        hapticLight();
        updatePosition(e.clientX);
    };

    // Effective clip position based on hold-to-compare state
    const effectiveClip = isHoldingOriginal ? 0 : sliderPos;

    return (
        <div className="relative w-full h-full select-none">
            {/* Top comparison mode buttons */}
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 bg-black/60 backdrop-blur-md p-1 rounded-full border border-white/20 shadow-lg">
                <button
                    onClick={() => { hapticLight(); setSliderPos(0); }}
                    className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase transition-all ${sliderPos <= 5 && !isHoldingOriginal ? 'bg-white text-black shadow' : 'text-white/80 hover:text-white'}`}
                >
                    Original
                </button>
                <button
                    onClick={() => { hapticLight(); setSliderPos(50); }}
                    className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase transition-all ${sliderPos > 5 && sliderPos < 95 && !isHoldingOriginal ? 'bg-blue-600 text-white shadow' : 'text-white/80 hover:text-white'}`}
                >
                    Split
                </button>
                <button
                    onClick={() => { hapticLight(); setSliderPos(100); }}
                    className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase transition-all ${sliderPos >= 95 && !isHoldingOriginal ? 'bg-purple-600 text-white shadow' : 'text-white/80 hover:text-white'}`}
                >
                    AI Render
                </button>
            </div>

            {/* Container */}
            <div
                ref={containerRef}
                className="relative w-full h-full overflow-hidden rounded-xl cursor-col-resize"
                onClick={handleContainerClick}
            >
                {/* Behind layer — Original (BEFORE) */}
                <img
                    src={beforeImage}
                    alt="Original space"
                    className="absolute inset-0 w-full h-full object-contain bg-black"
                    draggable={false}
                />

                {/* Front layer — AI Result (AFTER) — clipped */}
                <div
                    className="absolute inset-0 overflow-hidden transition-[clip-path] duration-150 ease-out"
                    style={{ clipPath: `inset(0 ${100 - effectiveClip}% 0 0)` }}
                >
                    <img
                        src={afterImage}
                        alt="AI generated result"
                        className="absolute inset-0 w-full h-full object-contain bg-black"
                        draggable={false}
                    />
                </div>

                {/* Slider line & handle (hidden during hold-to-compare) */}
                {!isHoldingOriginal && (
                    <>
                        <div
                            className="absolute top-0 bottom-0 z-20 pointer-events-none"
                            style={{ left: `${sliderPos}%` }}
                        >
                            <div className="absolute inset-0 w-[3px] bg-white shadow-[0_0_12px_rgba(0,0,0,0.6)] -translate-x-1/2" />
                        </div>

                        {/* Draggable handle */}
                        <div
                            className="absolute top-1/2 z-30 -translate-y-1/2 -translate-x-1/2"
                            style={{ left: `${sliderPos}%` }}
                            onMouseDown={handleMouseDown}
                            onTouchStart={handleTouchStart}
                        >
                            {/* Outer ring */}
                            <div className="w-12 h-12 rounded-full bg-white/95 shadow-2xl flex items-center justify-center border-[3px] border-white cursor-col-resize hover:scale-110 active:scale-95 transition-transform">
                                <div className="flex gap-[2px] text-gray-700">
                                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                                    </svg>
                                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                                    </svg>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Hold to Compare floating button (Mobile & Desktop) */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30">
                <button
                    onMouseDown={() => { hapticLight(); setIsHoldingOriginal(true); }}
                    onMouseUp={() => setIsHoldingOriginal(false)}
                    onMouseLeave={() => setIsHoldingOriginal(false)}
                    onTouchStart={(e) => { e.preventDefault(); hapticLight(); setIsHoldingOriginal(true); }}
                    onTouchEnd={() => setIsHoldingOriginal(false)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-xs font-black uppercase tracking-wider backdrop-blur-md shadow-2xl border transition-all select-none ${
                        isHoldingOriginal
                            ? 'bg-amber-500 text-white border-amber-300 scale-105 shadow-amber-500/50'
                            : 'bg-black/70 hover:bg-black/90 text-white border-white/20 active:scale-95'
                    }`}
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    <span>{isHoldingOriginal ? 'Mostrando Original' : 'Mantén para ver Original'}</span>
                </button>
            </div>

            {/* Material badge if provided */}
            {materialThumbnail && (
                <div className="absolute bottom-4 right-4 z-30 w-12 h-12 md:w-14 md:h-14 rounded-xl overflow-hidden border-2 border-white shadow-xl bg-white">
                    <img
                        src={materialThumbnail}
                        alt="Material"
                        className="w-full h-full object-cover"
                    />
                </div>
            )}
        </div>
    );
};
