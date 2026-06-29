import React from "react";

const LOGO_URL =
    "https://res.cloudinary.com/dsex1a9tu/image/upload/v1768992973/Logo_Building_PNG_u0cjpu.png";

export const BrandLogo = ({ className = "w-10 h-10" }: { className?: string }) => (
    <img
        src={LOGO_URL}
        alt="Building Innovation Logo"
        className={`${className} object-contain`}
        loading="eager"
    />
);
