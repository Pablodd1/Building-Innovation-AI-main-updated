import React, { useState, useRef, useCallback, useLayoutEffect } from 'react';
import { VirtualPreviewEngine } from '../services/virtualPreview';
import { Material } from '../types';

interface VirtualPreviewProps {
  material: Material;
  capturedImage: string; // base64 or URL
  onClose: () => void;
  onSave: (previewImage: string) => void;
  lang?: 'en' | 'es';
}

const translations = {
  en: {
    title: 'Virtual Preview',
    subtitle: 'See how this looks in your space',
    detecting: 'Detecting walls...',
    adjustCorners: 'Drag blue corners to adjust',
    opacity: 'Opacity',
    scale: 'Scale',
    blendMode: 'Blend',
    showEdges: 'Edges',
    normal: 'Normal',
    multiply: 'Multiply',
    overlay: 'Overlay',
    download: 'Save Preview',
    reset: 'Reset',
    close: 'Close',
    noWalls: 'No walls auto-detected. Adjust manually.',
    wall: 'Wall',
    tip: 'Drag blue dots to fit your surface',
  },
  es: {
    title: 'Vista Previa Virtual',
    subtitle: 'Ve cómo se ve en tu espacio',
    detecting: 'Detectando paredes...',
    adjustCorners: 'Arrastra las esquinas azules',
    opacity: 'Opacidad',
    scale: 'Escala',
    blendMode: 'Fusión',
    showEdges: 'Bordes',
    normal: 'Normal',
    multiply: 'Multiplicar',
    overlay: 'Superponer',
    download: 'Guardar Vista',
    reset: 'Reiniciar',
    close: 'Cerrar',
    noWalls: 'No se detectaron paredes. Ajusta manualmente.',
    wall: 'Pared',
    tip: 'Arrastra los puntos azules para ajustar',
  }
};

export const VirtualPreview: React.FC<VirtualPreviewProps> = ({
  material,
  capturedImage,
  onClose,
  onSave,
  lang = 'en'
}) => {
  const t = translations[lang];
  const [step, setStep] = useState<'detecting' | 'preview'>('detecting');
  const [hasDetection, setHasDetection] = useState(false);
  const [quads, setQuads] = useState<number>(0);
  const [totalQuads, setTotalQuads] = useState(0);
  const [opacity, setOpacity] = useState(0.92);
  const [scale, setScale] = useState(1.0);
  const [blendMode, setBlendMode] = useState('multiply');
  const [showEdges, setShowEdges] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overlayStyle, setOverlayStyle] = useState<React.CSSProperties>({});
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<VirtualPreviewEngine | null>(null);

  // Initialize engine when canvas is available
  useLayoutEffect(() => {
    if (!canvasRef.current || engineRef.current) return;
    const engine = new VirtualPreviewEngine(canvasRef.current);
    engine.onUpdate = () => {
      setOverlayStyle(engine.getOverlayStyle());
    };
    engineRef.current = engine;
  });

  // Load background on mount
  useLayoutEffect(() => {
    const init = async () => {
      if (!engineRef.current) return;
      try {
        const { width, height } = await engineRef.current.loadBackground(capturedImage);
        setCanvasSize({ w: width, h: height });
        
        if (engineRef.current.detectedQuads.length > 0) {
          setHasDetection(true);
          setTotalQuads(engineRef.current.detectedQuads.length);
        } else {
          setHasDetection(false);
        }
        
        // Load product image
        await engineRef.current.loadProduct(material.imageUrl);
        setOverlayStyle(engineRef.current.getOverlayStyle());
        setStep('preview');
      } catch (e) {
        console.error('Virtual preview init failed:', e);
        setError(lang === 'es' ? 'Error al cargar imagen' : 'Failed to load image');
        setStep('preview');
      }
    };
    init();
  }, [capturedImage, material.imageUrl, lang]);

  // Pointer events for corner dragging (touch + mouse)
  const getCanvasCoords = useCallback((clientX: number, clientY: number) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!engineRef.current || !canvasRef.current) return;
    e.preventDefault();
    const { x, y } = getCanvasCoords(e.clientX, e.clientY);
    const hit = engineRef.current.handlePointerDown(x, y);
    if (hit) setIsDragging(true);
  }, [getCanvasCoords]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!engineRef.current || !isDragging) return;
    e.preventDefault();
    const { x, y } = getCanvasCoords(e.clientX, e.clientY);
    engineRef.current.handlePointerMove(x, y);
    setOverlayStyle(engineRef.current.getOverlayStyle());
  }, [getCanvasCoords, isDragging]);

  const handlePointerUp = useCallback(() => {
    if (!engineRef.current) return;
    engineRef.current.handlePointerUp();
    setIsDragging(false);
  }, []);

  // Controls
  const handleOpacityChange = (v: number) => {
    setOpacity(v);
    if (engineRef.current) engineRef.current.setOpacity(v);
  };

  const handleScaleChange = (v: number) => {
    setScale(v);
    if (engineRef.current) engineRef.current.setScale(v);
  };

  const handleBlendChange = (m: string) => {
    setBlendMode(m);
    if (engineRef.current) engineRef.current.setBlendMode(m);
  };

  const handleToggleEdges = () => {
    setShowEdges(!showEdges);
    if (engineRef.current) engineRef.current.toggleEdges();
  };

  const handleSelectQuad = (idx: number) => {
    setQuads(idx);
    if (engineRef.current) {
      engineRef.current.selectQuad(idx);
      setOverlayStyle(engineRef.current.getOverlayStyle());
    }
  };

  const handleSave = () => {
    if (!engineRef.current) return;
    try {
      const dataUrl = engineRef.current.exportImage();
      onSave(dataUrl);
    } catch (e) {
      setError('Export failed');
    }
  };

  const handleReset = () => {
    if (!engineRef.current) return;
    engineRef.current.bgImage = null;
    engineRef.current.productImage = null;
    engineRef.current.productSrc = '';
    engineRef.current.corners = [];
    engineRef.current.cssMatrix = null;
    engineRef.current.draw();
    setOverlayStyle({});
    setStep('detecting');
    setHasDetection(false);
    setError(null);
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/90 backdrop-blur-md flex flex-col"
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {/* Header */}
      <div className="bg-slate-900/90 border-b border-slate-700 p-4 flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-white font-bold text-lg">{t.title}</h2>
          <p className="text-slate-400 text-sm">{material.name}</p>
        </div>
        <button
          onClick={onClose}
          className="w-10 h-10 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-white transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Canvas area */}
        <div className="flex-1 bg-slate-950 flex items-center justify-center relative overflow-auto p-4">
          {step === 'detecting' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-slate-950/90">
              <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
              <p className="text-white font-medium">{t.detecting}</p>
            </div>
          )}

          {error && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-500/20 border border-red-500/50 text-red-400 px-4 py-2 rounded-lg text-sm z-30">
              {error}
            </div>
          )}

          <div ref={containerRef} className="relative" style={{ maxWidth: '100%', maxHeight: '70vh' }}>
            <div className="relative inline-block">
              <canvas
                ref={canvasRef}
                style={{ display: 'block', maxWidth: '100%', maxHeight: '70vh' }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
              />

              {/* CSS 3D Overlay */}
              {overlayStyle.backgroundImage && overlayStyle.backgroundImage !== 'none' && (
                <div
                  className="absolute top-0 left-0 pointer-events-none"
                  style={{
                    ...overlayStyle,
                    width: canvasSize.w + 'px',
                    height: canvasSize.h + 'px',
                  }}
                />
              )}
            </div>
          </div>

          {step === 'preview' && !isDragging && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/70 text-white text-xs px-3 py-1.5 rounded-full pointer-events-none">
              {t.tip}
            </div>
          )}
        </div>

        {/* Controls sidebar */}
        <div className="w-full lg:w-80 bg-slate-900 border-l border-slate-700 p-4 flex flex-col gap-4 overflow-y-auto shrink-0">
          {/* Detected walls */}
          {totalQuads > 1 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase mb-2">{t.wall}</p>
              <div className="flex gap-2 flex-wrap">
                {Array.from({ length: totalQuads }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => handleSelectQuad(i)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      quads === i
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-800 border border-slate-700 text-slate-300 hover:border-blue-500'
                    }`}
                  >
                    {t.wall} {i + 1}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!hasDetection && step === 'preview' && (
            <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <p className="text-sm text-yellow-400">{t.noWalls}</p>
            </div>
          )}

          {/* Opacity */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-slate-300">{t.opacity}</span>
              <span className="text-sm text-slate-500">{Math.round(opacity * 100)}%</span>
            </div>
            <input
              type="range" min="0.3" max="1" step="0.01" value={opacity}
              onChange={(e) => handleOpacityChange(parseFloat(e.target.value))}
              className="w-full accent-blue-500"
            />
          </div>

          {/* Scale */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-slate-300">{t.scale}</span>
              <span className="text-sm text-slate-500">{scale.toFixed(1)}x</span>
            </div>
            <input
              type="range" min="0.5" max="3" step="0.1" value={scale}
              onChange={(e) => handleScaleChange(parseFloat(e.target.value))}
              className="w-full accent-blue-500"
            />
          </div>

          {/* Blend Mode */}
          <div>
            <p className="text-sm font-medium text-slate-300 mb-2">{t.blendMode}</p>
            <div className="grid grid-cols-3 gap-2">
              {['normal', 'multiply', 'overlay'].map((m) => (
                <button
                  key={m}
                  onClick={() => handleBlendChange(m)}
                  className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    blendMode === m
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-800 border border-slate-700 text-slate-300 hover:border-blue-500'
                  }`}
                >
                  {(t as any)[m] || m}
                </button>
              ))}
            </div>
          </div>

          {/* Show edges */}
          <button
            onClick={handleToggleEdges}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors w-full ${
              showEdges
                ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30'
                : 'bg-slate-800 border border-slate-700 text-slate-300 hover:border-blue-500'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            {t.showEdges}
          </button>

          <div className="border-t border-slate-700 my-2"></div>

          {/* Actions */}
          <div className="flex flex-col gap-2">
            <button
              onClick={handleSave}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 text-white hover:from-blue-500 hover:to-blue-600 transition-colors font-semibold"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              {t.download}
            </button>
            <button
              onClick={handleReset}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:border-slate-500 transition-colors text-sm font-medium"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {t.reset}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
