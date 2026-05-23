import React from 'react';

interface ImageComparatorProps {
    originalImage: string;
    resultImage: string;
}

export const ImageComparator: React.FC<ImageComparatorProps> = ({ originalImage, resultImage }) => {
    return (
        <div className="grid grid-cols-2 gap-4">
            <div>
                <p className="text-sm font-medium mb-2">Original</p>
                <img src={originalImage} alt="Original" className="w-full rounded-lg" />
            </div>
            <div>
                <p className="text-sm font-medium mb-2">Result</p>
                <img src={resultImage} alt="Result" className="w-full rounded-lg" />
            </div>
        </div>
    );
};
