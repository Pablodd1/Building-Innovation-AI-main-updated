import React from 'react';

export const CameraCapture: React.FC<{ onCapture: (file: File) => void }> = ({ onCapture }) => {
    const inputRef = React.useRef<HTMLInputElement>(null);

    const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) onCapture(file);
        if (inputRef.current) inputRef.current.value = '';
    };

    return (
        <div className="flex flex-col items-center gap-4">
            <input
                ref={inputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFile}
                className="hidden"
                id="camera-input"
            />
            <label
                htmlFor="camera-input"
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-semibold cursor-pointer transition-colors"
            >
                Take Photo
            </label>
        </div>
    );
};
