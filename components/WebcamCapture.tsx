import React, { useEffect, useRef, useState } from 'react';

interface WebcamCaptureProps {
    onCapture: (file: File) => void;
    onClose: () => void;
    lang: 'en' | 'es';
}

export const WebcamCapture: React.FC<WebcamCaptureProps> = ({ onCapture, onClose, lang }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
    const [hasMultipleCameras, setHasMultipleCameras] = useState(true);
    const [isFlashing, setIsFlashing] = useState(false);

    const stopStream = (s: MediaStream | null) => {
        s?.getTracks().forEach((track) => track.stop());
    };

    const startCamera = async (mode: 'user' | 'environment' = facingMode) => {
        setError(null);
        stopStream(stream);
        try {
            let mediaStream: MediaStream;
            try {
                mediaStream = await navigator.mediaDevices.getUserMedia({
                    video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: { ideal: mode } }
                });
            } catch (constrainedErr) {
                console.warn('[Webcam] Constrained request failed, retrying with basic facingMode:', constrainedErr);
                try {
                    mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode } });
                } catch {
                    mediaStream = await navigator.mediaDevices.getUserMedia({ video: true });
                    setHasMultipleCameras(false);
                }
            }
            setStream(mediaStream);
            if (videoRef.current) {
                videoRef.current.srcObject = mediaStream;
            }
        } catch (err: any) {
            console.error('[Webcam] Access error:', err?.name, err?.message);
            const isDenied = err?.name === 'NotAllowedError';
            const isInUse = err?.name === 'NotReadableError' || err?.name === 'AbortError';
            setError(lang === 'es'
                ? (isDenied
                    ? 'Permiso de cámara denegado. Por favor permite el acceso a la cámara en los ajustes de tu navegador.'
                    : isInUse
                    ? 'La cámara está siendo usada por otra aplicación. Ciérrala o sube una foto desde tu galería.'
                    : 'No se pudo iniciar la cámara. Puedes subir una foto desde tu galería.')
                : (isDenied
                    ? 'Camera permission denied. Please allow camera access in your browser settings.'
                    : isInUse
                    ? 'Camera is in use by another app. Close it or upload a photo from your gallery.'
                    : 'Could not access camera. You can upload a photo from your device instead.')
            );
        }
    };

    useEffect(() => {
        navigator.mediaDevices?.enumerateDevices?.()
            .then((devices) => {
                const videoInputs = devices.filter((d) => d.kind === 'videoinput');
                setHasMultipleCameras(videoInputs.length > 1);
            })
            .catch(() => setHasMultipleCameras(true));
    }, []);

    useEffect(() => {
        startCamera(facingMode);
        return () => {
            stopStream(stream);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lang]);

    const handleFlipCamera = () => {
        const nextMode = facingMode === 'environment' ? 'user' : 'environment';
        setFacingMode(nextMode);
        startCamera(nextMode);
    };

    const handleCapture = () => {
        if (!videoRef.current) return;

        // Flash visual feedback
        setIsFlashing(true);
        setTimeout(() => setIsFlashing(false), 250);

        const video = videoRef.current;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;

        const ctx = canvas.getContext('2d');
        if (ctx) {
            if (facingMode === 'user') {
                ctx.translate(canvas.width, 0);
                ctx.scale(-1, 1);
            }
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) => {
                if (blob) {
                    const file = new File([blob], `camera_capture_${Date.now()}.jpg`, { type: 'image/jpeg' });
                    stopStream(stream);
                    onCapture(file);
                }
            }, 'image/jpeg', 0.9);
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            stopStream(stream);
            onCapture(file);
        }
        if (e.target) e.target.value = '';
    };

    return (
        <div className="fixed inset-0 z-[9999] bg-black flex flex-col justify-between overflow-hidden select-none touch-none">
            {/* Shutter Flash Animation */}
            {isFlashing && (
                <div className="absolute inset-0 z-50 bg-white opacity-80 pointer-events-none transition-opacity duration-200" />
            )}

            {/* Video Viewport / Background */}
            <div className="absolute inset-0 w-full h-full bg-black overflow-hidden flex items-center justify-center">
                {error ? (
                    <div className="relative z-20 max-w-sm mx-4 p-6 bg-slate-900/95 border border-slate-700 rounded-3xl text-center shadow-2xl backdrop-blur-xl">
                        <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center">
                            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3l18 18" />
                            </svg>
                        </div>
                        <h4 className="text-white font-bold text-base mb-2">
                            {lang === 'es' ? 'Acceso a Cámara' : 'Camera Access'}
                        </h4>
                        <p className="text-gray-300 text-xs mb-6 leading-relaxed">
                            {error}
                        </p>
                        <div className="flex flex-col gap-3">
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="w-full py-3.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 rounded-xl text-white font-bold text-sm shadow-lg flex items-center justify-center gap-2"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                {lang === 'es' ? 'Elegir de Galería / Archivos' : 'Choose from Gallery / Files'}
                            </button>
                            <button
                                onClick={() => startCamera(facingMode)}
                                className="w-full py-3 px-4 bg-slate-800 hover:bg-slate-700 text-gray-200 border border-slate-600 rounded-xl text-xs font-semibold"
                            >
                                {lang === 'es' ? 'Reintentar Cámara' : 'Retry Camera'}
                            </button>
                            <button
                                onClick={onClose}
                                className="w-full py-2.5 px-4 text-gray-400 hover:text-white text-xs font-medium"
                            >
                                {lang === 'es' ? 'Cerrar' : 'Close'}
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            muted
                            className={`w-full h-full object-cover ${facingMode === 'user' ? 'scale-x-[-1]' : ''}`}
                        />
                        {/* Framing guide / grid for room alignment */}
                        <div className="absolute inset-0 pointer-events-none opacity-20 border-[1.5px] border-white/40 m-6 rounded-2xl grid grid-cols-3 grid-rows-3">
                            <div className="border-r border-b border-white/30" />
                            <div className="border-r border-b border-white/30" />
                            <div className="border-b border-white/30" />
                            <div className="border-r border-b border-white/30" />
                            <div className="border-r border-b border-white/30" />
                            <div className="border-b border-white/30" />
                            <div className="border-r border-white/30" />
                            <div className="border-r border-white/30" />
                            <div />
                        </div>
                    </>
                )}
            </div>

            {/* Top Bar Floating Controls */}
            <div className="relative z-20 w-full pt-[max(1rem,env(safe-area-inset-top,16px))] px-4 pb-3 flex items-center justify-between bg-gradient-to-b from-black/80 via-black/40 to-transparent">
                <button
                    onClick={onClose}
                    aria-label={lang === 'es' ? 'Cerrar cámara' : 'Close camera'}
                    className="w-11 h-11 rounded-full bg-black/50 hover:bg-black/80 backdrop-blur-md border border-white/20 flex items-center justify-center text-white transition-all active:scale-95"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                {/* Status Indicator */}
                {!error && (
                    <div className="px-3.5 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/15 text-white text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        {facingMode === 'environment'
                            ? (lang === 'es' ? 'Cámara Trasera' : 'Rear Camera')
                            : (lang === 'es' ? 'Cámara Frontal' : 'Front Camera')}
                    </div>
                )}

                {/* Flip Camera Button */}
                {!error && hasMultipleCameras ? (
                    <button
                        onClick={handleFlipCamera}
                        aria-label={lang === 'es' ? 'Cambiar cámara' : 'Flip camera'}
                        className="w-11 h-11 rounded-full bg-black/50 hover:bg-black/80 backdrop-blur-md border border-white/20 flex items-center justify-center text-white transition-all active:scale-95"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    </button>
                ) : (
                    <div className="w-11 h-11" />
                )}
            </div>

            {/* Bottom Bar Floating Shutter & Controls */}
            {!error && (
                <div className="relative z-20 w-full pb-[max(2.25rem,env(safe-area-inset-bottom,28px))] pt-6 px-6 bg-gradient-to-t from-black/90 via-black/50 to-transparent">
                    <div className="max-w-md mx-auto flex items-center justify-around">
                        {/* Gallery / File Picker button on the left */}
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="flex flex-col items-center gap-1 text-white/90 hover:text-white transition-opacity active:scale-95"
                        >
                            <div className="w-12 h-12 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-md border border-white/25 flex items-center justify-center shadow-lg">
                                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                            </div>
                            <span className="text-[11px] font-semibold text-white/80">
                                {lang === 'es' ? 'Galería' : 'Gallery'}
                            </span>
                        </button>

                        {/* Large Circular Shutter Button in the center */}
                        <button
                            onClick={handleCapture}
                            aria-label={lang === 'es' ? 'Tomar foto' : 'Take photo'}
                            className="group relative flex items-center justify-center p-1 rounded-full active:scale-90 transition-transform duration-150"
                        >
                            <div className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center shadow-2xl bg-white/10 backdrop-blur-sm group-hover:scale-105 transition-transform">
                                <div className="w-16 h-16 rounded-full bg-white group-active:bg-gray-200 transition-colors shadow-inner" />
                            </div>
                        </button>

                        {/* Flip camera / Back button on the right */}
                        <button
                            onClick={hasMultipleCameras ? handleFlipCamera : onClose}
                            className="flex flex-col items-center gap-1 text-white/90 hover:text-white transition-opacity active:scale-95"
                        >
                            <div className="w-12 h-12 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-md border border-white/25 flex items-center justify-center shadow-lg">
                                {hasMultipleCameras ? (
                                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                ) : (
                                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                )}
                            </div>
                            <span className="text-[11px] font-semibold text-white/80">
                                {hasMultipleCameras
                                    ? (lang === 'es' ? 'Girar' : 'Flip')
                                    : (lang === 'es' ? 'Salir' : 'Exit')}
                            </span>
                        </button>
                    </div>
                </div>
            )}

            {/* Hidden file input for gallery fallback */}
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
            />
        </div>
    );
};
