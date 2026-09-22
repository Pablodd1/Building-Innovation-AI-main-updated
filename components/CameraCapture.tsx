import React, { useState } from 'react';
import { WebcamCapture } from './WebcamCapture';

interface CameraCaptureProps {
    onImageCapture: (file: File) => void;
    lang: 'en' | 'es';
}

const SAMPLE_ROOMS = [
    {
        id: 'living-room',
        nameEs: 'Sala de Estar',
        nameEn: 'Living Room',
        url: 'https://res.cloudinary.com/dsex1a9tu/image/upload/v1768992973/Espacio_Int_ipvzyz.jpg',
    },
    {
        id: 'exterior-patio',
        nameEs: 'Espacio Exterior',
        nameEn: 'Exterior Space',
        url: 'https://res.cloudinary.com/dsex1a9tu/image/upload/v1768992973/Espacio_Ext_t4ic8u.jpg',
    },
    {
        id: 'modern-room',
        nameEs: 'Habitación Moderna',
        nameEn: 'Modern Bedroom',
        url: 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=800&q=80',
    },
    {
        id: 'minimal-lounge',
        nameEs: 'Pared Acento',
        nameEn: 'Accent Wall',
        url: 'https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=800&q=80',
    },
];

export const CameraCapture: React.FC<CameraCaptureProps> = ({ onImageCapture, lang }) => {
    const galleryRef = React.useRef<HTMLInputElement>(null);
    const [showWebcam, setShowWebcam] = useState(false);
    const [loadingSample, setLoadingSample] = useState<string | null>(null);

    const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) onImageCapture(file);
        if (e.target) e.target.value = '';
    };

    const handleSelectSample = async (sample: typeof SAMPLE_ROOMS[0]) => {
        try {
            setLoadingSample(sample.id);
            const response = await fetch(sample.url, { mode: 'cors' });
            const blob = await response.blob();
            const file = new File([blob], `sample_${sample.id}.jpg`, { type: blob.type || 'image/jpeg' });
            onImageCapture(file);
        } catch (error) {
            console.error('Failed to load sample image:', error);
            // Fallback: create canvas and draw image
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth || 800;
                canvas.height = img.naturalHeight || 600;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(img, 0, 0);
                    canvas.toBlob((blob) => {
                        if (blob) {
                            const file = new File([blob], `sample_${sample.id}.jpg`, { type: 'image/jpeg' });
                            onImageCapture(file);
                        }
                    }, 'image/jpeg', 0.9);
                }
            };
            img.src = sample.url;
        } finally {
            setLoadingSample(null);
        }
    };

    const t = {
        title: lang === 'es' ? 'Capturar o Subir Foto' : 'Capture or Upload Photo',
        subtitle: lang === 'es' ? 'Toma una foto de tu habitación o selecciona una existente' : 'Take a photo of your room or pick an existing one',
        takePhoto: lang === 'es' ? 'Tomar Foto (Cámara)' : 'Take Photo (Camera)',
        takePhotoDesc: lang === 'es' ? 'Abre la cámara en vivo con selector frontal/trasera' : 'Opens live camera with front/rear flip',
        chooseGallery: lang === 'es' ? 'Elegir de la Galería' : 'Choose from Gallery',
        chooseGalleryDesc: lang === 'es' ? 'Sube una imagen desde tu dispositivo o archivos' : 'Upload an image from your device or files',
        sampleRoomsTitle: lang === 'es' ? 'O prueba con una habitación de muestra' : 'Or try with a sample room',
        loading: lang === 'es' ? 'Cargando...' : 'Loading...',
    };

    return (
        <div className="w-full max-w-lg mx-auto flex flex-col items-center gap-5 px-4 py-2 sm:py-6 animate-fadeIn select-none">
            {/* Title & Subtitle */}
            <div className="text-center space-y-1">
                <h3 className="text-white text-xl sm:text-2xl font-black tracking-tight">
                    {t.title}
                </h3>
                <p className="text-gray-400 text-xs sm:text-sm max-w-xs mx-auto">
                    {t.subtitle}
                </p>
            </div>

            {/* Hidden file input for gallery */}
            <input
                ref={galleryRef}
                type="file"
                accept="image/*"
                onChange={handleFile}
                className="hidden"
                id="gallery-input"
            />

            {/* Primary Action: Take Photo Button */}
            <button
                type="button"
                onClick={() => setShowWebcam(true)}
                className="w-full group bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-500 hover:to-indigo-600 text-white p-4 sm:p-5 rounded-2xl font-bold transition-all shadow-xl shadow-blue-600/30 active:scale-[0.98] border border-blue-400/30 flex items-center justify-between"
            >
                <div className="flex items-center gap-3.5">
                    <div className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur-md flex items-center justify-center shrink-0">
                        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                    </div>
                    <div className="text-left">
                        <div className="text-base sm:text-lg font-extrabold tracking-tight">
                            {t.takePhoto}
                        </div>
                        <div className="text-[11px] sm:text-xs text-blue-100 font-medium">
                            {t.takePhotoDesc}
                        </div>
                    </div>
                </div>
                <svg className="w-5 h-5 text-white/70 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                </svg>
            </button>

            {/* Secondary Action: Choose from Gallery */}
            <button
                type="button"
                onClick={() => galleryRef.current?.click()}
                className="w-full group bg-slate-900/90 hover:bg-slate-800 text-white p-4 sm:p-5 rounded-2xl font-bold transition-all border border-slate-700 active:scale-[0.98] shadow-lg flex items-center justify-between"
            >
                <div className="flex items-center gap-3.5">
                    <div className="w-12 h-12 rounded-xl bg-slate-800 border border-slate-600 flex items-center justify-center shrink-0 text-slate-300">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                    </div>
                    <div className="text-left">
                        <div className="text-base sm:text-lg font-extrabold tracking-tight text-gray-100">
                            {t.chooseGallery}
                        </div>
                        <div className="text-[11px] sm:text-xs text-gray-400 font-medium">
                            {t.chooseGalleryDesc}
                        </div>
                    </div>
                </div>
                <svg className="w-5 h-5 text-gray-400 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                </svg>
            </button>

            {/* Sample Rooms Preset Grid */}
            <div className="w-full pt-2">
                <div className="flex items-center gap-2 mb-3">
                    <div className="h-px bg-slate-800 flex-1" />
                    <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider text-center">
                        {t.sampleRoomsTitle}
                    </span>
                    <div className="h-px bg-slate-800 flex-1" />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {SAMPLE_ROOMS.map((sample) => (
                        <button
                            key={sample.id}
                            type="button"
                            disabled={loadingSample === sample.id}
                            onClick={() => handleSelectSample(sample)}
                            className="group relative flex flex-col rounded-xl overflow-hidden border border-slate-800 hover:border-blue-500 bg-slate-900 transition-all hover:scale-[1.03] active:scale-95 text-left disabled:opacity-50"
                        >
                            <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-950">
                                <img
                                    src={sample.url}
                                    alt={lang === 'es' ? sample.nameEs : sample.nameEn}
                                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                                />
                                {loadingSample === sample.id && (
                                    <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    </div>
                                )}
                            </div>
                            <div className="p-2">
                                <span className="text-[11px] font-bold text-gray-200 block truncate group-hover:text-blue-400 transition-colors">
                                    {lang === 'es' ? sample.nameEs : sample.nameEn}
                                </span>
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Full-Screen In-App Camera Overlay */}
            {showWebcam && (
                <WebcamCapture
                    onCapture={(file) => {
                        onImageCapture(file);
                        setShowWebcam(false);
                    }}
                    onClose={() => setShowWebcam(false)}
                    lang={lang}
                />
            )}
        </div>
    );
};
