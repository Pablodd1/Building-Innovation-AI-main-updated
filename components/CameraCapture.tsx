import React from 'react';

// Inline SVG icons (no external dependency needed)
const CameraIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
);

const GalleryIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
);

export const CameraCapture: React.FC<{ 
    onImageCapture: (file: File) => void;
    lang: 'en' | 'es';
}> = ({ onImageCapture, lang }) => {
    const cameraRef = React.useRef<HTMLInputElement>(null);
    const galleryRef = React.useRef<HTMLInputElement>(null);

    const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) onImageCapture(file);
        if (e.target) e.target.value = '';
    };

    const t = {
        takePhoto: lang === 'es' ? 'Tomar Foto' : 'Take Photo',
        chooseFromGallery: lang === 'es' ? 'Elegir de Galería' : 'Choose from Gallery',
        or: lang === 'es' ? 'o' : 'or',
        captureHint: lang === 'es' 
            ? 'Abre la cámara para capturar el espacio en tiempo real.' 
            : 'Opens your camera to capture the space in real time.',
        galleryHint: lang === 'es'
            ? 'Selecciona una foto existente de tu dispositivo.'
            : 'Pick an existing photo from your device gallery.',
    };

    return (
        <div className="flex flex-col items-center gap-6 p-6">
            <h3 className="text-white text-lg font-semibold">
                {lang === 'es' ? 'Capturar Espacio' : 'Capture Space'}
            </h3>
            
            {/* Hidden file inputs */}
            <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFile}
                className="hidden"
                id="camera-input"
            />
            <input
                ref={galleryRef}
                type="file"
                accept="image/*"
                onChange={handleFile}
                className="hidden"
                id="gallery-input"
            />

            {/* Take Photo button — opens device camera */}
            <button
                onClick={() => cameraRef.current?.click()}
                className="w-full max-w-xs flex items-center justify-center gap-3 bg-blue-600 hover:bg-blue-700 text-white px-6 py-4 rounded-xl font-semibold transition-colors shadow-lg shadow-blue-600/25"
            >
                <CameraIcon />
                {t.takePhoto}
            </button>
            <p className="text-gray-400 text-xs text-center -mt-2">{t.captureHint}</p>

            {/* Divider */}
            <div className="flex items-center gap-3 w-full max-w-xs">
                <div className="flex-1 h-px bg-gray-600" />
                <span className="text-gray-500 text-sm">{t.or}</span>
                <div className="flex-1 h-px bg-gray-600" />
            </div>

            {/* Choose from Gallery button — opens file picker */}
            <button
                onClick={() => galleryRef.current?.click()}
                className="w-full max-w-xs flex items-center justify-center gap-3 bg-gray-700 hover:bg-gray-600 text-white px-6 py-4 rounded-xl font-semibold transition-colors border border-gray-500"
            >
                <GalleryIcon />
                {t.chooseFromGallery}
            </button>
            <p className="text-gray-400 text-xs text-center -mt-2">{t.galleryHint}</p>
        </div>
    );
};
