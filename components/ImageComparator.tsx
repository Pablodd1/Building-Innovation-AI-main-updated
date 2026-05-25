import React, { useState, useRef, useCallback, useEffect } from 'react';

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
        setIsDragging(true);
    };

    const handleTouchStart = (e: React.TouchEvent) => {
        e.preventDefault();
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
        document.addEventListener('touchmove', handleMove, { passive: false });
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
        updatePosition(e.clientX);
    };

    return (
        <div className="relative w-full h-full select-none">
            {/* BEFORE label */}
            <div className="absolute top-3 left-3 z-30 bg-black/70 text-white text-xs font-bold px-3 py-1.5 rounded-full uppercase tracking-wider backdrop-blur-sm pointer-events-none">
                Original
            </div>

            {/* AFTER label */}
            <div className="absolute top-3 right-3 z-30 bg-blue-600/80 text-white text-xs font-bold px-3 py-1.5 rounded-full uppercase tracking-wider backdrop-blur-sm pointer-events-none">
                AI Result
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
                    className="absolute inset-0 overflow-hidden"
                    style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
                >
                    <img
                        src={afterImage}
                        alt="AI generated result"
                        className="absolute inset-0 w-full h-full object-contain bg-black"
                        draggable={false}
                    />
                </div>

                {/* Slider line */}
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
                    <div className="w-12 h-12 rounded-full bg-white/90 shadow-2xl flex items-center justify-center border-[3px] border-white cursor-col-resize hover:scale-110 transition-transform">
                        {/* Arrows */}
                        <div className="flex gap-[2px] text-gray-500">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                            </svg>
                        </div>
                    </div>
                </div>
            </div>

            {/* Material badge if provided */}
            {materialThumbnail && (
                <div className="absolute bottom-4 right-4 z-30 w-14 h-14 rounded-xl overflow-hidden border-3 border-white shadow-xl bg-white">
                    <img
                        src={materialThumbnail}
                        alt="Material"
                        className="w-full h-full object-cover"
                    />
                </div>
            )}

            {/* Instruction hint — fades away */}
            <div
                className={`absolute bottom-4 left-4 z-30 text-white/60 text-xs bg-black/50 backdrop-blur-sm px-3 py-1.5 rounded-full transition-opacity duration-1000 pointer-events-none ${isDragging ? 'opacity-0' : 'opacity-100'}`}
            >
                ← Drag slider to compare →
            </div>
        </div>
    );
};
