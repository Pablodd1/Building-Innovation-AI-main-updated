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
    // 'environment' = back/rear camera (default — better for scanning rooms),
    // 'user' = front/selfie camera. Toggled by the flip button below.
    const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
    const [hasMultipleCameras, setHasMultipleCameras] = useState(true);

    const stopStream = (s: MediaStream | null) => {
        s?.getTracks().forEach((track) => track.stop());
    };

    const startCamera = async (mode: 'user' | 'environment' = facingMode) => {
        setError(null);
        // Stop any existing stream before requesting a new one — switching
        // facingMode requires a fresh getUserMedia call; browsers do not let
        // you swap the camera on a live track.
        stopStream(stream);
        try {
            let mediaStream: MediaStream;
            try {
                mediaStream = await navigator.mediaDevices.getUserMedia({
                    video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: { ideal: mode } }
                });
            } catch (constrainedErr) {
                // Fallback: some laptops/older Android WebViews reject width/height/facingMode
                // constraints outright (NotReadableError, OverconstrainedError). Retry with a
                // bare video:true request so the camera still opens even without facingMode control.
                console.warn('[Webcam] Constrained request failed, retrying with basic facingMode:', constrainedErr?.name);
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
                    ? 'Permiso de cámara denegado. Haz clic en el ícono del candado en la barra de direcciones y permite el acceso a la cámara.'
                    : isInUse
                    ? 'La cámara está siendo usada por otra aplicación. Ciérrala e inténtalo de nuevo, o sube una foto.'
                    : 'No se pudo acceder a la cámara. Puedes subir una foto de tu dispositivo.')
                : (isDenied
                    ? 'Camera permission denied. Click the padlock icon in the URL bar and allow camera access.'
                    : isInUse
                    ? 'Camera is in use by another app. Close it and retry, or upload a photo instead.'
                    : 'Could not access camera. You can upload a photo from your device instead.')
            );
        }
    };

    // Detect if the device actually has more than one camera (some tablets/
    // laptops only have one). Skips showing a flip button that would do nothing.
    useEffect(() => {
        navigator.mediaDevices?.enumerateDevices?.()
            .then((devices) => {
                const videoInputs = devices.filter((d) => d.kind === 'videoinput');
                setHasMultipleCameras(videoInputs.length > 1);
            })
            .catch(() => setHasMultipleCameras(true)); // assume yes if we can't detect
    }, []);

    useEffect(() => {
        startCamera(facingMode);
        // Cleanup stream on unmount
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

        const video = videoRef.current;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;

        const ctx = canvas.getContext('2d');
        if (ctx) {
            // Only mirror the preview for the front/selfie camera — the rear
            // camera should capture un-mirrored (what you actually see through
            // the lens), which is what users expect for room/wall photos.
            if (facingMode === 'user') {
                ctx.translate(canvas.width, 0);
                ctx.scale(-1, 1);
            }
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) => {
                if (blob) {
                    const file = new File([blob], `webcam_capture_${Date.now()}.jpg`, { type: 'image/jpeg' });
                    onCapture(file);
                }
            }, 'image/jpeg', 0.9);
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) onCapture(file);
        if (e.target) e.target.value = '';
    };

    return (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-4">
            <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden shadow-2xl flex flex-col animate-fadeIn">
                {/* Header */}
                <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950">
                    <h3 className="text-white font-semibold">
                        {lang === 'es' ? 'Tomar Foto (Cámara)' : 'Take Photo (Camera)'}
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white transition-colors"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Stream / Error View */}
                <div className="relative flex-1 bg-black aspect-video flex items-center justify-center">
                    {error ? (
                        <div className="p-6 text-center max-w-sm">
                            <svg className="w-12 h-12 mx-auto mb-3 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 3l18 18" />
                            </svg>
                            <p className="text-red-400 font-medium text-sm mb-4">{error}</p>
                            {/* Upload alternative — primary action when camera fails */}
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="w-full px-5 py-3 bg-blue-600 hover:bg-blue-700 rounded-xl text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2 mb-2"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                {lang === 'es' ? 'Subir Foto del Dispositivo' : 'Upload Photo from Device'}
                            </button>
                            <button
                                onClick={() => startCamera(facingMode)}
                                className="w-full px-5 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-gray-300 font-semibold text-sm transition-colors"
                            >
                                {lang === 'es' ? 'Reintentar Cámara' : 'Retry Camera'}
                            </button>
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
                            {/* Flip camera button — top-right corner, always visible when streaming.
                                Works on iOS Safari 14.3+ and all modern Android Chrome/WebView via
                                getUserMedia facingMode constraint — no dependency on OS-level camera
                                app UI, so it's consistent across every Android and iPhone model. */}
                            {hasMultipleCameras && (
                                <button
                                    onClick={handleFlipCamera}
                                    aria-label={lang === 'es' ? 'Cambiar cámara' : 'Flip camera'}
                                    className="absolute top-3 right-3 w-11 h-11 rounded-full bg-black/50 hover:bg-black/70 backdrop-blur-sm border border-white/20 flex items-center justify-center text-white transition-colors"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                </button>
                            )}
                            {/* Current camera indicator */}
                            <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-sm text-white text-[10px] font-semibold uppercase tracking-wide">
                                {facingMode === 'environment'
                                    ? (lang === 'es' ? 'Trasera' : 'Back')
                                    : (lang === 'es' ? 'Frontal' : 'Front')}
                            </div>
                        </>
                    )}
                </div>

                {/* Controls */}
                <div className="p-4 border-t border-slate-800 flex justify-center gap-4 bg-slate-950">
                    <button
                        onClick={onClose}
                        className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-gray-300 font-semibold text-sm transition-colors"
                    >
                        {lang === 'es' ? 'Cancelar' : 'Cancel'}
                    </button>
                    {!error && (
                        <button
                            onClick={handleCapture}
                            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 rounded-xl text-white font-semibold text-sm transition-colors flex items-center gap-2"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                            </svg>
                            {lang === 'es' ? 'Capturar' : 'Capture'}
                        </button>
                    )}
                </div>
            </div>

            {/* Hidden file input for upload fallback */}
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
