// Lightweight haptic feedback utility using standard Web Vibrate API
// Safely no-ops on desktop or unsupported devices without throwing errors.

export const hapticLight = () => {
    try {
        if (typeof window !== 'undefined' && 'navigator' in window && 'vibrate' in navigator) {
            navigator.vibrate(10);
        }
    } catch {
        // Silently ignore if blocked by browser policy
    }
};

export const hapticMedium = () => {
    try {
        if (typeof window !== 'undefined' && 'navigator' in window && 'vibrate' in navigator) {
            navigator.vibrate(25);
        }
    } catch {
        // Silently ignore
    }
};

export const hapticSuccess = () => {
    try {
        if (typeof window !== 'undefined' && 'navigator' in window && 'vibrate' in navigator) {
            navigator.vibrate([15, 60, 25]);
        }
    } catch {
        // Silently ignore
    }
};
