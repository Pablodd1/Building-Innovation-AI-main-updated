import React, { useState, useRef, useEffect } from 'react';

interface ImageComparatorProps {
  beforeImage: string;
  afterImage: string;
  materialThumbnail?: string;
  labelBefore?: string;
  labelAfter?: string;
}

export const ImageComparator: React.FC<ImageComparatorProps> = ({
  beforeImage,
  afterImage,
  materialThumbnail,
  labelBefore = "Original",
  labelAfter = "Visualize"
}) => {
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = () => setIsResizing(true);
  const handleMouseUp = () => setIsResizing(false);

  const handleMouseMove = (e: MouseEvent | TouchEvent | React.MouseEvent | React.TouchEvent) => {
    if (!isResizing || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    let x: number;

    // Check if it's a touch event safely
    if ('touches' in e) {
      // We need to safely cast to access touches on a generic event union
      const touchEvent = e as unknown as React.TouchEvent;
      x = touchEvent.touches[0].clientX;
    } else {
      const mouseEvent = e as unknown as React.MouseEvent;
      x = mouseEvent.clientX;
    }
    
    // Calculate position relative to the container
    const xRelative = x - rect.left;
    const percentage = (xRelative / rect.width) * 100;

    // Clamp between 0 and 100
    setSliderPosition(Math.min(Math.max(percentage, 0), 100));
  };

  useEffect(() => {
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchend', handleMouseUp);
    
    // Add global mousemove to handle dragging outside the component bounds slightly
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove as any);
      document.addEventListener('touchmove', handleMouseMove as any);
    }

    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchend', handleMouseUp);
      document.removeEventListener('mousemove', handleMouseMove as any);
      document.removeEventListener('touchmove', handleMouseMove as any);
    };
  }, [isResizing]);

  return (
    <div 
      className="relative w-full aspect-[4/3] lg:aspect-[16/9] select-none overflow-hidden rounded-2xl border border-slate-700 shadow-2xl bg-slate-950"
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onTouchMove={handleMouseMove}
    >
      {/* Background Image (After/Modified) */}
      <img 
        src={afterImage} 
        alt="Modified" 
        className="absolute inset-0 w-full h-full object-cover pointer-events-none"
      />
      <div className="absolute top-4 right-4 bg-black/60 backdrop-blur text-white text-xs px-2 py-1 rounded pointer-events-none font-semibold border border-white/10 z-10">
        {labelAfter}
      </div>

      {/* Foreground Image (Before/Original) - Clipped */}
      <div 
        className="absolute inset-0 h-full pointer-events-none overflow-hidden border-r-2 border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.5)]"
        style={{ width: `${sliderPosition}%` }}
      >
        <img 
          src={beforeImage} 
          alt="Original" 
          className="absolute inset-0 w-full h-full object-cover max-w-none"
          // Important: max-w-none ensures image doesn't squash, it stays fixed relative to container width
          style={{ width: containerRef.current ? containerRef.current.offsetWidth : '100%' }}
        />
         <div className="absolute top-4 left-4 bg-black/60 backdrop-blur text-white text-xs px-2 py-1 rounded pointer-events-none font-semibold border border-white/10">
          {labelBefore}
        </div>
      </div>

      {/* Material Reference Overlay */}
      {materialThumbnail && (
        <div className="absolute bottom-4 left-4 z-20 flex items-center bg-black/70 backdrop-blur-md border border-slate-600 rounded-lg p-2 shadow-xl animate-fadeIn max-w-[150px]">
          <img 
            src={materialThumbnail} 
            alt="Reference" 
            className="w-10 h-10 rounded border border-slate-500 object-cover mr-3"
          />
          <div className="flex flex-col">
            <span className="text-[9px] uppercase text-slate-400 font-bold tracking-wider">Material Ref</span>
            <span className="text-[10px] text-white font-bold leading-tight">Applied</span>
          </div>
        </div>
      )}

      {/* Slider Handle */}
      <div 
        className="absolute inset-y-0 w-10 -ml-5 cursor-ew-resize flex items-center justify-center group z-30"
        style={{ left: `${sliderPosition}%` }}
        onMouseDown={handleMouseDown}
        onTouchStart={handleMouseDown}
      >
        <div className="w-10 h-10 rounded-full bg-blue-600 shadow-lg flex items-center justify-center border-4 border-slate-900 group-hover:scale-110 transition-transform">
          <svg className="w-5 h-5 text-white pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
          </svg>
        </div>
      </div>
    </div>
  );
};