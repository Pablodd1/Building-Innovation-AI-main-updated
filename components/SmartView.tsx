import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Material } from '../types';

interface SmartViewProps {
  material: Material;
  capturedImage: string;
  onClose: () => void;
  onApply: (resultImage: string) => void;
  lang?: 'en' | 'es';
}

const t = {
  en: {
    title: 'Smart View',
    subtitle: 'See material on your wall',
    opacity: 'Intensity',
    scale: 'Tile Size',
    apply: 'Apply to Project',
    close: 'Close',
    tip: 'Adjust how the material appears on your wall',
    normal: 'Normal',
    multiply: 'Blend',
    overlay: 'Overlay',
  },
  es: {
    title: 'Vista Inteligente',
    subtitle: 'Ve el material en tu pared',
    opacity: 'Intensidad',
    scale: 'Tamaño de Baldosa',
    apply: 'Aplicar al Proyecto',
    close: 'Cerrar',
    tip: 'Ajusta cómo se ve el material en tu pared',
    normal: 'Normal',
    multiply: 'Mezclar',
    overlay: 'Superponer',
  }
};

export const SmartView: React.FC<SmartViewProps> = ({
  material,
  capturedImage,
  onClose,
  onApply,
  lang = 'en'
}) => {
  const texts = t[lang];
  const [opacity, setOpacity] = useState(0.75);
  const [scale, setScale] = useState(1);
  const [blendMode, setBlendMode] = useState('multiply');
  const [bgLoaded, setBgLoaded] = useState(false);
  const [prodLoaded, setProdLoaded] = useState(false);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgRef = useRef<HTMLImageElement | null>(null);
  const prodRef = useRef<HTMLImageElement | null>(null);

  // Load images
  useEffect(() => {
    const bg = new Image();
    bg.crossOrigin = 'anonymous';
    bg.onload = () => {
      bgRef.current = bg;
      setBgLoaded(true);
    };
    bg.src = capturedImage;

    const prod = new Image();
    prod.crossOrigin = 'anonymous';
    prod.onload = () => {
      prodRef.current = prod;
      setProdLoaded(true);
    };
    prod.src = material.imageUrl;

    return () => {
      bg.onload = null;
      prod.onload = null;
    };
  }, [capturedImage, material.imageUrl]);

  // Render canvas
  const render = useCallback(() => {
    if (!canvasRef.current || !bgRef.current || !prodRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    const bg = bgRef.current;
    const prod = prodRef.current;

    // Set canvas to match background
    canvas.width = bg.naturalWidth;
    canvas.height = bg.naturalHeight;

    // Draw background
    ctx.drawImage(bg, 0, 0);

    // Create pattern from product image
    const patternCanvas = document.createElement('canvas');
    const pw = prod.naturalWidth * scale;
    const ph = prod.naturalHeight * scale;
    patternCanvas.width = pw;
    patternCanvas.height = ph;
    const pctx = patternCanvas.getContext('2d')!;
    pctx.drawImage(prod, 0, 0, pw, ph);

    const pattern = ctx.createPattern(patternCanvas, 'repeat');
    if (!pattern) return;

    // Apply blend
    ctx.save();
    ctx.globalAlpha = opacity;
    if (blendMode === 'multiply') {
      ctx.globalCompositeOperation = 'multiply';
    } else if (blendMode === 'overlay') {
      ctx.globalCompositeOperation = 'overlay';
    }
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }, [opacity, scale, blendMode]);

  // Re-render when controls change
  useEffect(() => {
    if (bgLoaded && prodLoaded) render();
  }, [bgLoaded, prodLoaded, render]);

  const handleApply = () => {
    if (!canvasRef.current) return;
    const dataUrl = canvasRef.current.toDataURL('image/jpeg', 0.92);
    onApply(dataUrl);
  };

  const bothLoaded = bgLoaded && prodLoaded;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/90 backdrop-blur-md flex flex-col">
      {/* Header */}
      <div className="bg-slate-900/90 border-b border-slate-700 p-4 flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-white font-bold text-lg">{texts.title}</h2>
          <p className="text-slate-400 text-sm">{material.name}</p>
        </div>
        <button
          onClick={onClose}
          className="w-10 h-10 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-white"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Canvas */}
        <div className="flex-1 bg-slate-950 flex items-center justify-center relative overflow-auto p-4">
          {!bothLoaded && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-slate-950/90">
              <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
              <p className="text-white">Loading...</p>
            </div>
          )}
          <canvas
            ref={canvasRef}
            className="max-w-full max-h-[70vh] object-contain shadow-2xl"
          />
          {bothLoaded && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/70 text-white text-xs px-3 py-1.5 rounded-full pointer-events-none">
              {texts.tip}
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="w-full lg:w-80 bg-slate-900 border-l border-slate-700 p-4 flex flex-col gap-4 overflow-y-auto shrink-0">
          {/* Opacity */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-slate-300">{texts.opacity}</span>
              <span className="text-sm text-slate-500">{Math.round(opacity * 100)}%</span>
            </div>
            <input
              type="range" min="0.1" max="1" step="0.01" value={opacity}
              onChange={(e) => setOpacity(parseFloat(e.target.value))}
              className="w-full accent-blue-500"
            />
          </div>

          {/* Scale */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-slate-300">{texts.scale}</span>
              <span className="text-sm text-slate-500">{scale.toFixed(1)}x</span>
            </div>
            <input
              type="range" min="0.2" max="3" step="0.1" value={scale}
              onChange={(e) => setScale(parseFloat(e.target.value))}
              className="w-full accent-blue-500"
            />
          </div>

          {/* Blend Mode */}
          <div>
            <p className="text-sm font-medium text-slate-300 mb-2">Blend</p>
            <div className="grid grid-cols-3 gap-2">
              {['normal', 'multiply', 'overlay'].map((m) => (
                <button
                  key={m}
                  onClick={() => setBlendMode(m)}
                  className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    blendMode === m
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-800 border border-slate-700 text-slate-300 hover:border-blue-500'
                  }`}
                >
                  {(texts as any)[m] || m}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-slate-700 my-2"></div>

          {/* Apply */}
          <button
            onClick={handleApply}
            disabled={!bothLoaded}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 text-white hover:from-blue-500 hover:to-blue-600 transition-colors font-semibold disabled:opacity-50"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {texts.apply}
          </button>
        </div>
      </div>
    </div>
  );
};
