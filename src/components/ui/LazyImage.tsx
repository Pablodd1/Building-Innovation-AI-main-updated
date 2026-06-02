import React, { useState } from "react";

const PLACEHOLDER =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect fill='%23e5e7eb' width='100' height='100'/%3E%3C/svg%3E";

export const LazyImage = ({
    src,
    alt,
    className,
    fallback,
}: {
    src: string;
    alt: string;
    className?: string;
    fallback?: string;
}) => {
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState(false);
    const placeholderSrc = fallback || PLACEHOLDER;

    return (
        <img
            src={error ? placeholderSrc : src}
            alt={alt}
            className={`${className} ${loaded ? "opacity-100" : "opacity-70"} transition-opacity duration-200`}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            onError={() => setError(true)}
        />
    );
};
