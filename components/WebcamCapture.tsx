import React, { useEffect, useRef, useState } from 'react';

interface WebcamCaptureProps {
    onCapture: (file: File) => void;
    onClose: () => void;
    lang: 'en' | 'es';
}

export const WebcamCapture: React.FC<WebcamCaptureProps> = ({ onCapture, onClose, lang }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // Start webcam stream
        navigator.mediaDevices.getUserMedia({ 
            video: { width: 1280, height: 720, facingMode: 'user' } 
        })
        .then((mediaStream) => {
            setStream(mediaStream);
            if (videoRef.current) {
                videoRef.current.srcObject = mediaStream;
            }
        })
        .catch((err) => {
            console.error('[Webcam] Access error:', err);
            setError(lang === 'es' 
                ? 'No se pudo acceder a la cámara. Asegúrate de que el navegador tenga permisos (busca el ícono del candado en la barra de direcciones) y de que ninguna otra aplicación esté usando la cámara.' 
                : 'Could not access camera. Please ensure your browser has camera permissions (check the padlock icon in the URL bar) and no other app is using it.'
            );
        });

        // Cleanup stream on unmount
        return () => {
            if (stream) {
                stream.getTracks().forEach((track) => track.stop());
            }
        };
    }, [lang]);

    const handleCapture = () => {
        if (!videoRef.current) return;

        const video = videoRef.current;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;

        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) => {
                if (blob) {
                    const file = new File([blob], `webcam_capture_${Date.now()}.jpg`, { type: 'image/jpeg' });
                    onCapture(file);
                }
            }, 'image/jpeg', 0.9);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-4">
            <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden shadow-2xl flex flex-col animate-fadeIn">
                {/* Header */}
                <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950">
                    <h3 className="text-white font-semibold">
                        {lang === 'es' ? 'Tomar Foto (Cámara)' : 'Take Photo (Webcam)'}
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
                        <div className="p-6 text-red-400 text-center font-medium max-w-sm">
                            {error}
                        </div>
                    ) : (
                        <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            className="w-full h-full object-cover scale-x-[-1]"
                        />
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
        </div>
    );
};
