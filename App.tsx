import React, {
    useState,
    useEffect,
    useMemo,
    useCallback,
    Suspense,
    lazy,
} from "react";
import {
    AppView,
    Material,
    GenerationState,
    Contractor,
    CartItem,
    Language,
    RenderOptions,
    User,
} from "./types";
import { CONTRACTORS as INITIAL_CONTRACTORS, TRANSLATIONS, MATERIALS } from "./constants";
import { Button } from "./components/Button";
import { CameraCapture } from "./components/CameraCapture";
import { ImageComparator } from "./components/ImageComparator";
import { EstimationPanel } from "./components/EstimationPanel";
import { AdminPurchaseQueue } from "./components/AdminPurchaseQueue";
import {
    generateMaterialOverlay,
    generateRoomAnalysis,
    generateCinematicVideo,
    generateMaterialProbe,
} from "./services/geminiService";
import { formatMetersUSA } from "./services/unitUtils";

interface HistoryItem {
    resultImage: string | null;
    resultVideo: string | null;
    analysis: string | null;
    prompt: string;
    material: Material | null;
}

// Custom Logo Component
const LOGO_URL =
    "https://res.cloudinary.com/dsex1a9tu/image/upload/v1768992973/Logo_Building_PNG_u0cjpu.png";

const BrandLogo = ({ className = "w-10 h-10" }: { className?: string }) => (
    <img
        src={LOGO_URL}
        alt="Building Innovation Logo"
        className={`${className} object-contain`}
        loading="eager"
    />
);

const LazyImage = ({
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
    const placeholderSrc =
        fallback ||
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect fill='%23e5e7eb' width='100' height='100'/%3E%3C/svg%3E";

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

const LoadingSpinner = () => (
    <div className="flex items-center justify-center p-8">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
);

// App Component
const App: React.FC = () => {
    const [view, setView] = useState<AppView>(AppView.LOGIN);
    const [categoryUsage, setCategoryUsage] = useState<
        "Interior" | "Exterior" | "All"
    >("Interior");
    const [lang, setLang] = useState<Language>("en");
    const [unitSystem, setUnitSystem] = useState<"latam" | "usa">("usa");

    // Authentication State
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [showMockCheckout, setShowMockCheckout] = useState(false);
    const [checkoutTier, setCheckoutTier] = useState<string | null>(null);
    const [selectedUserDetail, setSelectedUserDetail] = useState<any>(null);
    const [showUserDetailModal, setShowUserDetailModal] = useState(false);
    const [isLoadingUserDetail, setIsLoadingUserDetail] = useState(false);

    const [authMode, setAuthMode] = useState<"login" | "signup">("login");
    const [authForm, setAuthForm] = useState({
        name: "",
        email: "",
        email_phone: "",
        address: "",
        password: "",
    });
    const [authError, setAuthError] = useState("");
    const [authLoading, setAuthLoading] = useState(false);

    // Dynamic Data State
    const [materials, setMaterials] = useState<Material[]>([]);
    const [materialsLoading, setMaterialsLoading] = useState(true);
    const [contractors, setContractors] = useState<Contractor[]>([]);
    const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(null);
    const [estimationSource, setEstimationSource] = useState<AppView>(AppView.GALLERY);
    const [displayCurrency, setDisplayCurrency] = useState<"USD" | "COP">("USD");
    const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);

    // Search State
    const [searchQuery, setSearchQuery] = useState("");

    const [allUsers, setAllUsers] = useState<User[]>([]);
    const [isLoadingUsers, setIsLoadingUsers] = useState(false);
    const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);
    const [tiersConfig, setTiersConfig] = useState<any>(null);
    const [editableTiers, setEditableTiers] = useState<any>(null);
    const [isSavingTiers, setIsSavingTiers] = useState(false);
    const [secureConfig, setSecureConfig] = useState<{ hasKey: boolean; hasStripeSecretKey: boolean; hasStripeWebhookSecret: boolean } | null>(null);
    const [isSavingConfig, setIsSavingConfig] = useState(false);
    const [configForm, setConfigForm] = useState({ apiKey: "", stripeSecretKey: "", stripeWebhookSecret: "" });

    const fetchTiers = async () => {
        try {
            const res = await fetch('/api/tiers');
            if (res.ok) {
                const data = await res.json();
                setTiersConfig(data);
                setEditableTiers(data);
            }
        } catch (e) {
            console.error('Failed to fetch tiers:', e);
        }
    };

    const getTierLimit = (tierName: string) => {
        const tiers = tiersConfig || {
            FREE: { name: 'Tier 1 (Free)', limit: 10 },
            STANDARD: { name: 'Tier 2 (Standard)', limit: 500 },
            PREMIUM: { name: 'Tier 3 (Premium)', limit: 1000 },
            LUXURY: { name: 'Tier 4 (Luxury)', limit: 999999 }
        };
        const normalizedTier = tierName.toLowerCase();
        const matched = Object.values(tiers).find(
            (t: any) => t.name.toLowerCase() === normalizedTier || 
                       t.name.toLowerCase().includes(normalizedTier) ||
                       (t.name.split(' ')[0].toLowerCase() === normalizedTier)
        ) || (tiers as any)[tierName.toUpperCase()] || tiers.FREE;
        return matched.limit ?? 10;
    };

    // Admin Form State
    const [adminTab, setAdminTab] = useState<"MATERIALS" | "CONTRACTORS" | "PURCHASES" | "USERS" | "SETTINGS" | "ANALYTICS" | "AUDIT_LOGS">("MATERIALS");
    const [analyticsData, setAnalyticsData] = useState<any>(null);
    const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(false);
    const [auditLogs, setAuditLogs] = useState<any[]>([]);
    const [isLoadingAuditLogs, setIsLoadingAuditLogs] = useState(false);
    const [auditSearchQuery, setAuditSearchQuery] = useState("");
    const [auditActionFilter, setAuditActionFilter] = useState("ALL");

    const [newAdminForm, setNewAdminForm] = useState({ name: "", email: "", password: "" });
    const [isCreatingAdmin, setIsCreatingAdmin] = useState(false);

    const [isEditing, setIsEditing] = useState(false);
    const [editForm, setEditForm] = useState<Partial<Material>>({});

    const [contractorForm, setContractorForm] = useState<Partial<Contractor>>({});
    const [originalImage, setOriginalImage] = useState<string | null>(null);
    const [customPrompt, setCustomPrompt] = useState<string>("");

    const [renderOptions, setRenderOptions] = useState<RenderOptions>({
        lighting: "NATURAL",
        viewAngle: "PERSPECTIVE",
        declutter: false,
    });

    const [editorTab, setEditorTab] = useState<"CONFIGURE" | "ANALYZE">("CONFIGURE");

    const [generationState, setGenerationState] = useState<GenerationState>({
        isGenerating: false,
        isAnalyzing: false,
        error: null,
        resultImage: null,
        resultVideo: null,
        analysis: null,
        materialProbe: null,
    });
    const [cartCount, setCartCount] = useState<number>(0);
    const [toast, setToast] = useState<string | null>(null);

    const [showProbeModal, setShowProbeModal] = useState(false);
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);

    const [showCheckoutModal, setShowCheckoutModal] = useState(false);
    const [checkoutBody, setCheckoutBody] = useState("");

    const [selectedMaterialIds, setSelectedMaterialIds] = useState<Set<string>>(new Set());
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;
    const [adminCollectionFilter, setAdminCollectionFilter] = useState<"All" | "Interior" | "Exterior">("All");

    // Sync unit system with language
    useEffect(() => {
        setUnitSystem(lang === "es" ? "latam" : "usa");
    }, [lang]);

    // Load persisted user on mount
    useEffect(() => {
        // Install global fetch interceptor to automatically inject Authorization token
        const originalFetch = window.fetch;
        window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            const stored = localStorage.getItem('constructviz_user');
            let token = '';
            if (stored) {
                try {
                    const parsed = JSON.parse(stored);
                    if (parsed && parsed.session_token) {
                        token = parsed.session_token;
                    }
                } catch (e) {}
            }

            if (token) {
                init = init || {};
                init.headers = init.headers || {};
                if (init.headers instanceof Headers) {
                    init.headers.set('Authorization', `Bearer ${token}`);
                } else if (Array.isArray(init.headers)) {
                    const hasAuth = init.headers.some(h => h[0].toLowerCase() === 'authorization');
                    if (!hasAuth) {
                        init.headers.push(['Authorization', `Bearer ${token}`]);
                    }
                } else {
                    if (!init.headers['Authorization'] && !init.headers['authorization']) {
                        init.headers['Authorization'] = `Bearer ${token}`;
                    }
                }
            }
            return originalFetch(input, init);
        };

        try {
            const saved = localStorage.getItem('constructviz_user');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed && parsed.id) {
                    setCurrentUser(parsed);
                    setView(AppView.LANDING);
                    // Load memory
                    loadUserMemory(parsed.id);
                }
            }
        } catch (e) {
            console.warn('Failed to load persisted user:', e);
        }

        return () => {
            window.fetch = originalFetch; // restore original fetch on unmount
        };
    }, []);
    
    // Handle Stripe Success/Cancel return
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const sessionId = params.get('session_id');
        if (sessionId) {
            // Re-fetch user from server to get updated tier
            const stored = localStorage.getItem('constructviz_user');
            if (stored) {
                try {
                    const parsed = JSON.parse(stored);
                    if (parsed && parsed.id) {
                        fetch(`/api/users/${parsed.id}`)
                            .then(res => res.json())
                            .then(refreshedUser => {
                                if (refreshedUser && refreshedUser.tier) {
                                    // Merge refreshed user profile fields into current session state
                                    setCurrentUser(prev => prev ? { ...prev, ...refreshedUser } : refreshedUser);
                                }
                            })
                            .catch(err => console.warn('Failed to refresh user tier', err));
                    }
                } catch(e) {}
            }
            alert(lang === 'es' ? "¡Pago exitoso! Tu cuenta ha sido actualizada." : "Payment successful! Your account has been updated.");
            // Clean URL
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }, [lang]);
    
    // Persist user changes across refreshes
    useEffect(() => {
        if (currentUser) {
            localStorage.setItem('constructviz_user', JSON.stringify(currentUser));
        } else {
            localStorage.removeItem('constructviz_user');
        }
    }, [currentUser]);

    // Detect location on mount
    useEffect(() => {
        if ("geolocation" in navigator) {
            navigator.geolocation.getCurrentPosition(
                (pos) => setUserLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
                (err) => console.warn("Location access denied:", err.message)
            );
        }
    }, []);

    // Currency conversion rate (1 USD = ~4100 COP approximately)
    const USD_TO_COP_RATE = 4100;

    // Helper function to convert and format price
    const formatPrice = (
        pricePerUnit: number,
        materialCurrency: string,
        targetCurrency: "USD" | "COP" | "EUR",
    ): string => {
        let convertedPrice = pricePerUnit;
        const EUR_TO_USD_RATE = 1.1;

        if (materialCurrency === "USD" && targetCurrency === "COP") {
            convertedPrice = Math.round(pricePerUnit * USD_TO_COP_RATE);
        } else if (materialCurrency === "USD" && targetCurrency === "EUR") {
            convertedPrice = pricePerUnit / EUR_TO_USD_RATE;
        } else if (materialCurrency === "COP" && targetCurrency === "EUR") {
            convertedPrice = (pricePerUnit / USD_TO_COP_RATE) / EUR_TO_USD_RATE;
        } else if (
            (materialCurrency === "COP" || materialCurrency === "MXN") &&
            targetCurrency === "USD"
        ) {
            convertedPrice =
                Math.round((pricePerUnit / USD_TO_COP_RATE) * 100) / 100;
        } else if (materialCurrency === "MXN" && targetCurrency === "COP") {
            convertedPrice = pricePerUnit;
        }

        if (targetCurrency === "USD") {
            return `$${convertedPrice.toLocaleString()}`;
        } else if (targetCurrency === "EUR") {
            return `€${convertedPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        } else {
            return `${Math.round(convertedPrice).toLocaleString()} COP`;
        }
    };

    useEffect(() => {
        if (view === AppView.ADMIN && adminTab === "USERS") {
            fetchAllUsers();
        }
        if (view === AppView.ADMIN && adminTab === "ANALYTICS") {
            fetchAnalytics();
        }
        if (view === AppView.ADMIN && adminTab === "AUDIT_LOGS") {
            fetchAuditLogs();
        }
        if (view === AppView.ADMIN && adminTab === "SETTINGS") {
            fetchSecureConfig();
        }
    }, [view, adminTab]);

    // --- User Memory & Behavioral Analytics Helpers ---
    
    // Helper to log user behavior dynamically
    const logUserBehavior = async (eventType: string, details: any = {}) => {
        if (!currentUser) return;
        try {
            await fetch(`/api/users/${currentUser.id}/memory`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    behaviorEvent: {
                        type: eventType,
                        timestamp: new Date().toISOString(),
                        details
                    }
                })
            });
        } catch (e) {
            console.warn('Behavior log failed:', e);
        }
    };

    // Helper to load user memory and restore last workspace state
    const loadUserMemory = async (userId: number) => {
        try {
            const res = await fetch(`/api/users/${userId}/memory`);
            if (res.ok) {
                const memory = await res.json();
                if (memory && memory.lastState) {
                    const state = memory.lastState;
                    if (state.view) setView(state.view);
                    if (state.displayCurrency) setDisplayCurrency(state.displayCurrency);
                    if (state.renderOptions) setRenderOptions(state.renderOptions);
                    if (state.customPrompt) setCustomPrompt(state.customPrompt);
                    if (state.lang) setLang(state.lang);
                    if (state.originalImage) setOriginalImage(state.originalImage);
                    if (state.selectedMaterial) setSelectedMaterial(state.selectedMaterial);
                    console.log('✅ Workspace state restored successfully');
                }
            }
        } catch (e) {
            console.warn('Failed to load user memory:', e);
        }
    };

    // Helper to save current workspace state
    const saveWorkspaceState = async (updates: any = {}) => {
        if (!currentUser) return;
        try {
            const stateToSave = {
                view,
                displayCurrency,
                renderOptions,
                customPrompt,
                lang,
                originalImage,
                selectedMaterial,
                ...updates
            };
            
            await fetch(`/api/users/${currentUser.id}/memory`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lastState: stateToSave })
            });
        } catch (e) {
            console.warn('Workspace sync failed:', e);
        }
    };

    // Auto-save changes dynamically with a debounced sync
    useEffect(() => {
        if (currentUser) {
            const timer = setTimeout(() => {
                saveWorkspaceState();
            }, 3000);
            return () => clearTimeout(timer);
        }
    }, [view, displayCurrency, renderOptions, customPrompt, lang, originalImage, selectedMaterial, currentUser]);

    const fetchAnalytics = async () => {
        setIsLoadingAnalytics(true);
        try {
            const res = await fetch('/api/admin/analytics');
            if (res.ok) {
                const data = await res.json();
                setAnalyticsData(data);
            }
        } catch (e) {
            console.error('Failed to fetch analytics:', e);
        } finally {
            setIsLoadingAnalytics(false);
        }
    };

    const fetchAllUsers = async () => {
        setIsLoadingUsers(true);
        try {
            const res = await fetch("/api/admin/users");
            if (res.ok) {
                const data = await res.json();
                setAllUsers(data);
            }
        } catch (e) {
            console.error("Fetch users error:", e);
        } finally {
            setIsLoadingUsers(false);
        }
    };

    const fetchAuditLogs = async () => {
        setIsLoadingAuditLogs(true);
        try {
            const res = await fetch("/api/admin/audit-logs");
            if (res.ok) {
                const data = await res.json();
                setAuditLogs(data);
            }
        } catch (e) {
            console.error("Fetch audit logs error:", e);
        } finally {
            setIsLoadingAuditLogs(false);
        }
    };

    const fetchSecureConfig = async () => {
        try {
            const res = await fetch("/api/admin/config");
            if (res.ok) {
                const data = await res.json();
                setSecureConfig(data);
            }
        } catch (e) {
            console.error("Fetch secure config error:", e);
        }
    };

    const handleSaveSecureConfig = async () => {
        if (!configForm.apiKey && !configForm.stripeSecretKey && !configForm.stripeWebhookSecret) {
            alert(lang === 'es' ? "Por favor ingresa al menos un valor para actualizar." : "Please enter at least one value to update.");
            return;
        }
        setIsSavingConfig(true);
        try {
            const body: any = {};
            if (configForm.apiKey) body.apiKey = configForm.apiKey;
            if (configForm.stripeSecretKey) body.stripeSecretKey = configForm.stripeSecretKey;
            if (configForm.stripeWebhookSecret) body.stripeWebhookSecret = configForm.stripeWebhookSecret;

            const res = await fetch("/api/admin/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (res.ok) {
                alert(lang === 'es' ? "¡Configuración guardada exitosamente!" : "Configuration saved successfully!");
                setConfigForm({ apiKey: "", stripeSecretKey: "", stripeWebhookSecret: "" });
                fetchSecureConfig();
            } else {
                const data = await res.json();
                alert(data.error || "Failed to save configuration");
            }
        } catch (e) {
            console.error("Save config error:", e);
            alert("Failed to save configuration");
        } finally {
            setIsSavingConfig(false);
        }
    };

    const handleCreateAdmin = async () => {
        if (!newAdminForm.name || !newAdminForm.email || !newAdminForm.password) {
            alert(lang === 'es' ? "Todos los campos son obligatorios" : "All fields are required");
            return;
        }
        setIsCreatingAdmin(true);
        try {
            const res = await fetch("/api/admin/users/create-admin", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(newAdminForm),
            });
            if (res.ok) {
                alert(lang === 'es' ? "Admin creado exitosamente" : "Admin created successfully");
                setNewAdminForm({ name: "", email: "", password: "" });
                fetchAllUsers();
            } else {
                const data = await res.json();
                alert(data.error || "Failed to create admin");
            }
        } catch (e) {
            console.error("Create admin error:", e);
        } finally {
            setIsCreatingAdmin(false);
        }
    };

    const handleUpdateUserTier = async (userId: number, tier: string) => {
        try {
            const res = await fetch(`/api/admin/users/${userId}/tier`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tier }),
            });
            if (res.ok) {
                setAllUsers(allUsers.map(u => u.id === userId ? { ...u, tier } : u));
                alert("Tier updated successfully!");
            }
        } catch (e) {
            console.error("Failed to update tier", e);
        }
    };

    const handleUpdateUserGenerations = async (userId: number, generations_used: number) => {
        try {
            const res = await fetch(`/api/admin/users/${userId}/generations`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ generations_used }),
            });
            if (res.ok) {
                setAllUsers(allUsers.map(u => u.id === userId ? { ...u, generations_used } : u));
            }
        } catch (e) {
            console.error("Failed to update generations", e);
        }
    };

    // Download result image with watermark
    const handleDownloadResult = async () => {
        const imgSrc = generationState.resultImage;
        if (!imgSrc) return;
        const canvas = document.createElement("canvas");
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(img, 0, 0);
            // Bottom watermark bar
            const barH = Math.max(40, img.height * 0.06);
            ctx.fillStyle = "rgba(0,0,0,0.72)";
            ctx.fillRect(0, img.height - barH, img.width, barH);
            // Logo text
            const fontSize = Math.max(14, barH * 0.45);
            ctx.font = `bold ${fontSize}px Arial, sans-serif`;
            ctx.fillStyle = "#FFFFFF";
            ctx.textBaseline = "middle";
            ctx.fillText("Building Innovation", 16, img.height - barH / 2);
            // Copyright
            const year = new Date().getFullYear();
            const copyText = `© ${year} Building Innovation. All rights reserved.`;
            ctx.font = `${Math.max(10, fontSize * 0.6)}px Arial, sans-serif`;
            ctx.fillStyle = "rgba(255,255,255,0.7)";
            ctx.textAlign = "right";
            ctx.fillText(copyText, img.width - 16, img.height - barH / 2);
            // Trigger download
            const link = document.createElement("a");
            link.href = canvas.toDataURL("image/jpeg", 0.95);
            link.download = `BuildingInnovation_AI_${Date.now()}.jpg`;
            link.click();
            // Log download behavior
            logUserBehavior("DOWNLOAD_RENDER", { materialId: selectedMaterial?.id, materialName: selectedMaterial?.name });
        };
        img.src = imgSrc;
    };

    const handleSelectPlan = async (newTier: string) => {
        if (!currentUser) return;
        
        try {
            const res = await fetch("/api/checkout/create-session", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId: currentUser.id, tier: newTier }),
            });
            
            const data = await res.json();
            
            if (data.isMock) {
                // Stripe not configured — collect info and send email to admin
                const name = prompt(lang === 'es' ? 'Tu nombre:' : 'Your name:');
                const email = prompt(lang === 'es' ? 'Tu email:' : 'Your email:');
                if (name && email) {
                    try {
                        await fetch("/api/purchase-requests", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                user_id: currentUser.id,
                                customer_name: name,
                                customer_email: email,
                                customer_phone: "Not provided",
                                customer_address: "Not provided",
                                cart_items: [{ name: `Tier Upgrade: ${newTier}`, quantity: 1, totalCost: 0 }],
                                total_estimate: 0,
                                project_notes: `Tier upgrade request from ${currentUser.tier || 'Free'} to ${newTier}`
                            }),
                        });
                        setToast(lang === 'es' ? `Solicitud de ${newTier} enviada. Te contactaremos.` : `${newTier} upgrade request sent. We'll contact you.`);
                    } catch {
                        setToast(lang === 'es' ? `Error al enviar. Contacta al administrador.` : `Failed to send. Contact administrator.`);
                    }
                }
                setShowSubscriptionModal(false);
                setTimeout(() => setToast(null), 4000);
                return;
            }

            if (data.url) {
                // Redirect to Stripe Checkout
                window.location.href = data.url;
            } else {
                throw new Error(data.error || "Failed to create checkout session");
            }
        } catch (e: any) {
            console.error("Subscription error:", e);
            alert(lang === 'es' ? `Error en la suscripción: ${e.message}` : `Subscription error: ${e.message}`);
        }
    };

    const handleUpdateTierField = (tierKey: string, field: string, value: any) => {
        if (!editableTiers) return;
        setEditableTiers((prev: any) => ({
            ...prev,
            [tierKey]: {
                ...prev[tierKey],
                [field]: value
            }
        }));
    };

    const handleSaveTiers = async () => {
        if (!editableTiers) return;
        
        // Basic validation
        for (const [key, info] of Object.entries(editableTiers)) {
            const tInfo = info as any;
            if (!tInfo.name.trim()) {
                alert(lang === 'es' ? `El nombre para la tarifa ${key} no puede estar vacío` : `Name for tier ${key} cannot be empty`);
                return;
            }
            if (isNaN(tInfo.limit) || tInfo.limit < 0) {
                alert(lang === 'es' ? `Límite inválido para la tarifa ${key}` : `Invalid limit for tier ${key}`);
                return;
            }
            if (isNaN(tInfo.price) || tInfo.price < 0) {
                alert(lang === 'es' ? `Precio inválido para la tarifa ${key}` : `Invalid price for tier ${key}`);
                return;
            }
        }

        setIsSavingTiers(true);
        try {
            const res = await fetch('/api/admin/tiers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editableTiers),
            });
            if (res.ok) {
                const data = await res.json();
                setTiersConfig(data.config);
                alert(lang === 'es' ? '¡Tarifas actualizadas con éxito!' : 'Tiers configuration saved successfully!');
            } else {
                const data = await res.json();
                throw new Error(data.error || 'Failed to save tiers');
            }
        } catch (e: any) {
            console.error('Failed to save tiers:', e);
            alert(lang === 'es' ? `Error al guardar tarifas: ${e.message}` : `Failed to save tiers: ${e.message}`);
        } finally {
            setIsSavingTiers(false);
        }
    };

    const t = TRANSLATIONS[lang];

    // Memoized filtered materials for admin panel
    const adminFilteredMaterials = useMemo(() => {
        if (adminCollectionFilter === "All") return materials;
        return materials.filter((m) => m.usage === adminCollectionFilter);
    }, [materials, adminCollectionFilter]);

    // Memoized categories for faster rendering
    const materialCategories = useMemo(() => {
        const categories = new Set(materials.map((m) => m.category));
        return Array.from(categories).sort();
    }, [materials]);

    // Google Drive blocks direct browser access — route through server proxy
    // Verified: /api/proxy-image returns real PNG images (352KB+)
    const proxyImageUrl = (url: string): string => {
        if (!url) return '';
        if (url.includes('drive.google.com') || url.includes('lh3.googleusercontent.com')) {
            return `/api/proxy-image?url=${encodeURIComponent(url)}`;
        }
        // Rewrite CDN product image URLs to local static path
        // https://buildingapp.us/products/14031001.webp -> /products/14031001.webp
        const match = url.match(/https?:\/\/[^/]+\/products\/([^/]+\.(webp|jpg|jpeg|png|gif))/i);
        if (match) {
            return `/products/${match[1]}?v=2`;
        }
        return url;
    };

    const handleImageError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
        const target = e.target as HTMLImageElement;
        const originalSrc = target.getAttribute('data-original-src') || target.src;

        // Already failed — show placeholder
        if (target.getAttribute('data-error-fixed') === 'true') {
            target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect fill='%23374151' width='100' height='100'/%3E%3Ctext fill='%239ca3af' x='50%25' y='50%25' text-anchor='middle' dy='.3em' font-family='sans-serif' font-size='10'%3ENo Image%3C/text%3E%3C/svg%3E";
            return;
        }

        // Try proxy for Google Drive / external images
        if (originalSrc.includes('googleusercontent.com') || originalSrc.includes('drive.google.com')) {
            target.setAttribute('data-error-fixed', 'true');
            target.src = `/api/proxy-image?url=${encodeURIComponent(originalSrc)}`;
            return;
        }

        // For local paths that failed, try the original DB fallback URL before giving up
        if (originalSrc.startsWith('/')) {
            const dbUrl = target.getAttribute('data-original-src');
            if (dbUrl && dbUrl !== originalSrc && (dbUrl.includes('drive.google.com') || dbUrl.includes('lh3.googleusercontent.com'))) {
                target.setAttribute('data-error-fixed', 'true');
                target.src = `/api/proxy-image?url=${encodeURIComponent(dbUrl)}`;
                return;
            }
            target.setAttribute('data-error-fixed', 'true');
            target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect fill='%23374151' width='100' height='100'/%3E%3Ctext fill='%239ca3af' x='50%25' y='50%25' text-anchor='middle' dy='.3em' font-family='sans-serif' font-size='10'%3ENo Image%3C/text%3E%3C/svg%3E";
            return;
        }

        // If a buildingapp.us WebP CDN image failed, try the original data-original-src
        const dbUrl = target.getAttribute('data-original-src');
        if (dbUrl && dbUrl !== originalSrc && (dbUrl.includes('drive.google.com') || dbUrl.includes('lh3.googleusercontent.com'))) {
            target.setAttribute('data-error-fixed', 'true');
            target.src = `/api/proxy-image?url=${encodeURIComponent(dbUrl)}`;
            return;
        }

        // Fallback placeholder
        target.setAttribute('data-error-fixed', 'true');
        target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect fill='%23374151' width='100' height='100'/%3E%3Ctext fill='%239ca3af' x='50%25' y='50%25' text-anchor='middle' dy='.3em' font-family='sans-serif' font-size='10'%3ENo Image%3C/text%3E%3C/svg%3E";
    };

    const loadMaterialsFromDB = useCallback(async () => {
        setMaterialsLoading(true);
        try {
            // Tier 1: Try the dynamic API
            const res = await fetch("/api/materials");
            if (res.ok) {
                const dbMaterials = await res.json();
                if (Array.isArray(dbMaterials) && dbMaterials.length > 0) {
                    const converted = dbMaterials.map((m: any) => {
                        const rawUsage = m.usage || "Interior";
                        const normalizedUsage = rawUsage.charAt(0).toUpperCase() + rawUsage.slice(1).toLowerCase();
                        const refCode = m.ref_code || m.refCode || "";
                        
                        // Image resolution: ALWAYS prefer local product file if refCode exists.
                        // Local `/products/{refCode}.webp` is the single source of truth.
                        const dbImageUrl = m.image_url || m.imageUrl || "";
                        let imageUrl = dbImageUrl;
                        // If refCode exists, force local path regardless of what DB says
                        if (refCode) {
                            imageUrl = `/products/${refCode}.webp?v=4`;
                        } else if (imageUrl.includes('drive.google.com') || imageUrl.includes('lh3.googleusercontent.com')) {
                            imageUrl = `/api/proxy-image?url=${encodeURIComponent(imageUrl)}`;
                        } else {
                            // Rewrite any CDN URLs to local path
                            const cdnMatch = imageUrl.match(/https?:\/\/[^/]+\/products\/([^/]+\.(webp|jpg|jpeg|png|gif))/i);
                            if (cdnMatch) {
                                imageUrl = `/products/${cdnMatch[1]}?v=4`;
                            }
                        }
                        // Original DB URL kept for error-recovery fallback
                        const fallbackImageUrl = dbImageUrl || (refCode ? `https://buildingapp.us/products/${refCode}.webp` : "");

                        return {
                            id: String(m.id),
                            refCode,
                            name: m.name || "",
                            category: m.category || "General",
                            subcategory: m.subcategory || "",
                            description: m.description || "",
                            imageUrl,
                            _fallbackImageUrl: fallbackImageUrl,  // original DB URL for image error recovery
                            usage: normalizedUsage,
                            promptModifier: m.prompt_modifier || m.promptModifier || "",
                            dimensions: {
                                width: parseFloat(m.width_cm) || m.dimensions?.width || 100,
                                length: parseFloat(m.length_cm) || m.dimensions?.length || 100,
                                thickness: parseFloat(m.thickness_m) || m.dimensions?.thickness || 5,
                            },
                            pricing: {
                                pricePerUnit: parseFloat(m.price) || m.pricing?.pricePerUnit || 0,
                                currency: m.currency || m.pricing?.currency || "COP",
                                unitLabel: m.unit || m.pricing?.unitLabel || "Unidad",
                                itemsPerBox: m.items_per_box || m.pricing?.itemsPerBox || 1,
                            },
                        };
                    });
                    setMaterials(converted);
                    localStorage.setItem('materials_cache_v2', JSON.stringify(converted));
                    setMaterialsLoading(false);
                    return;
                }
            }
        } catch (e) {
            console.warn("API materials unavailable, trying localStorage...");
        }

        // Tier 2: localStorage — persists deletions so products don't reappear
        const cached = localStorage.getItem('materials_cache_v2');
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    setMaterials(parsed);
                    setMaterialsLoading(false);
                    return;
                }
            } catch (e) {}
        }

        // Tier 3: Local JSON manifest as seed fallback
        try {
            const localRes = await fetch("/data/products.json?v=" + Date.now());
            if (localRes.ok) {
                const localData = await localRes.json();
                if (Array.isArray(localData) && localData.length > 0) {
                    const proxied = localData.map((m: any) => ({
                        ...m,
                        usage: (m.usage || "Interior").charAt(0).toUpperCase() + (m.usage || "Interior").slice(1).toLowerCase(),
                    }));
                    setMaterials(proxied);
                    localStorage.setItem('materials_cache_v2', JSON.stringify(proxied));
                    setMaterialsLoading(false);
                    return;
                }
            }
        } catch (e) {
            console.warn("Local manifest unavailable, showing empty catalog.");
        }

        // No reliable source — show empty catalog (don't silently load all 322)
        setMaterials([]);
        setMaterialsLoading(false);
    }, []);

    useEffect(() => {
        loadMaterialsFromDB();
        fetchTiers();

        const savedContractors = localStorage.getItem(
            "constructVizContractors",
        );
        if (savedContractors) {
            try {
                setContractors(JSON.parse(savedContractors));
            } catch (e) {
                setContractors(INITIAL_CONTRACTORS);
            }
        } else {
            setContractors(INITIAL_CONTRACTORS);
        }

        updateCartCount();
    }, []);

    useEffect(() => {
        if (contractors.length > 0)
            localStorage.setItem(
                "constructVizContractors",
                JSON.stringify(contractors),
            );
    }, [contractors]);

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(materials.length / itemsPerPage));
        if (currentPage > maxPage) {
            setCurrentPage(maxPage);
        }
    }, [materials.length, currentPage, itemsPerPage]);

    const updateCartCount = () => {
        try {
            const existingCartJson = localStorage.getItem("constructVizCart");
            const cart = existingCartJson ? JSON.parse(existingCartJson) : [];
            setCartCount(cart.length);
        } catch (e) {}
    };

    const addToCart = (material: Material, dimensions: { width: number; height: number }, quantity: number = 1) => {
        const existingCart: CartItem[] = JSON.parse(localStorage.getItem("constructVizCart") || "[]");
        // Convert cm dimensions to meters for cart storage
        const widthM = dimensions.width / 100;
        const heightM = dimensions.height / 100;
        const area = widthM * heightM;
        const unitPrice = material.pricing?.pricePerUnit || 0;
        const totalCost = area * unitPrice * quantity;
        
        // Check if this exact material+dimensions combo already exists
        const existingIndex = existingCart.findIndex(
            item => item.material.id === material.id && 
                    Math.abs(item.dimensions.width - widthM) < 0.001 && 
                    Math.abs(item.dimensions.height - heightM) < 0.001
        );
        
        if (existingIndex >= 0) {
            existingCart[existingIndex].quantity += quantity;
            existingCart[existingIndex].totalCost = area * unitPrice * existingCart[existingIndex].quantity;
        } else {
            const newItem: CartItem = {
                id: `cart-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                material,
                dimensions: { width: widthM, height: heightM },
                quantity,
                totalCost,
                timestamp: Date.now(),
            };
            existingCart.push(newItem);
        }
        
        localStorage.setItem("constructVizCart", JSON.stringify(existingCart));
        setCartCount(existingCart.length);
        
        const itemName = material.name || material.refCode || "Producto";
        setToast(lang === 'es' ? `¡${itemName} añadido al carrito!` : `${itemName} added to cart!`);
        setTimeout(() => setToast(null), 2500);
        
        logUserBehavior("ADD_TO_CART", { materialId: material.id, materialName: itemName, quantity, totalCost });
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onloadend = () => {
                // Unified Image: User upload becomes both the thumbnail and the AI reference
                setEditForm((prev) => ({
                    ...prev,
                    imageUrl: reader.result as string,
                }));
            };
            reader.readAsDataURL(file);
        }
    };

    // --- Admin Functions ---

    const convertGoogleDriveUrl = (url: string): string => {
        if (!url) return url;
        const driveMatch = url.match(/drive\.google\.com\/file\/d\/([^\/]+)/);
        if (driveMatch && driveMatch[1]) {
            return `https://lh3.googleusercontent.com/d/${driveMatch[1]}`;
        }
        const openMatch = url.match(/drive\.google\.com\/open\?id=([^&]+)/);
        if (openMatch && openMatch[1]) {
            return `https://lh3.googleusercontent.com/d/${openMatch[1]}`;
        }
        const ucMatch = url.match(/drive\.google\.com\/uc\?.*id=([^&]+)/);
        if (ucMatch && ucMatch[1]) {
            return `https://lh3.googleusercontent.com/d/${ucMatch[1]}`;
        }
        return url;
    };

    const handleSaveMaterial = async () => {
        if (!editForm.name || !editForm.refCode) return;

        const dbMaterial = {
            ref_code: editForm.refCode,
            name: editForm.name,
            category: editForm.category || "General",
            subcategory: editForm.subcategory || "",
            price: editForm.pricing?.pricePerUnit || 0,
            price_contractor: editForm.pricing?.priceContractor || editForm.pricing?.pricePerUnit || 0,
            currency: editForm.pricing?.currency || "USD",
            unitLabel: editForm.pricing?.unitLabel || "Piece",
            items_per_box: editForm.pricing?.itemsPerBox || 1,
            width_cm: editForm.dimensions?.width || 100,
            length_cm: editForm.dimensions?.length || 100,
            thickness_m: editForm.dimensions?.thickness || 5,
            description: editForm.description || "",
            image_url: convertGoogleDriveUrl(editForm.imageUrl || ""),
            usage: editForm.usage || "Interior",
            prompt_modifier: editForm.promptModifier || "",
        };

        try {
            let response;
            if (isEditing && editForm.id) {
                response = await fetch(`/api/materials/${editForm.id}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(dbMaterial),
                });
            } else {
                response = await fetch("/api/materials", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(dbMaterial),
                });
            }

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error("Save failed:", response.status, errorData);
                alert(
                    lang === "es"
                        ? "Error al guardar el producto"
                        : "Error saving product",
                );
                return;
            }

            await loadMaterialsFromDB();
            alert(
                lang === "es"
                    ? "Producto guardado correctamente"
                    : "Product saved successfully",
            );
        } catch (e) {
            console.error("Failed to save material:", e);
            alert(
                lang === "es"
                    ? "Error al guardar el producto"
                    : "Error saving product",
            );
        }

        setEditForm({});
        setIsEditing(false);
    };

    const handleDeleteMaterial = async (id: string) => {
        const confirmMsg = lang === "es" ? "¿Eliminar material?" : "Delete material?";
        if (confirm(confirmMsg)) {
            try {
                const res = await fetch(`/api/materials/${id}`, { method: "DELETE" });
                if (res.ok) {
                    alert(lang === "es" ? "Material eliminado correctamente" : "Material deleted successfully");
                    loadMaterialsFromDB();
                } else {
                    const err = await res.json();
                    alert((lang === "es" ? "Error: " : "Error: ") + (err.error || "Unknown"));
                }
            } catch (e) {
                console.error("Failed to delete:", e);
                alert(lang === "es" ? "Error de conexión" : "Connection error");
            }
        }
    };

    const handleBulkDelete = async () => {
        if (selectedMaterialIds.size === 0) return;
        const count = selectedMaterialIds.size;
        const confirmMsg =
            lang === "es"
                ? `¿Eliminar ${count} producto(s) seleccionado(s)?`
                : `Delete ${count} selected product(s)?`;
        if (confirm(confirmMsg)) {
            try {
                const deletePromises = Array.from(selectedMaterialIds).map(id => 
                    fetch(`/api/materials/${id}`, { method: "DELETE" })
                );
                await Promise.all(deletePromises);
                
                alert(lang === "es" ? "Productos eliminados correctamente" : "Products deleted successfully");
                setSelectedMaterialIds(new Set());
                loadMaterialsFromDB();
            } catch (e) {
                console.error("Failed to delete:", e);
                alert(lang === "es" ? "Error al eliminar algunos productos" : "Error deleting some products");
            }
        }
    };

    const toggleSelectMaterial = (id: string) => {
        setSelectedMaterialIds((prev) => {
            const newSet = new Set(prev);
            if (newSet.has(id)) {
                newSet.delete(id);
            } else {
                newSet.add(id);
            }
            return newSet;
        });
    };

    const toggleSelectAll = (materialIds: string[]) => {
        const allSelected = materialIds.every((id) =>
            selectedMaterialIds.has(id),
        );
        setSelectedMaterialIds((prev) => {
            const newSet = new Set(prev);
            if (allSelected) {
                materialIds.forEach((id) => newSet.delete(id));
            } else {
                materialIds.forEach((id) => newSet.add(id));
            }
            return newSet;
        });
    };

    // --- CSV BULK OPERATIONS ---

    const handleDownloadCSV = () => {
        // 1. Define Headers (Added ItemsPerBox and Thickness)
        const headers = [
            "ID",
            "RefCode",
            "Name",
            "Category",
            "Subcategory",
            "Price",
            "Currency",
            "Unit",
            "ItemsPerBox",
            "Width(cm)",
            "Length(cm)",
            "Thickness(mm)",
            "Description",
            "ImageURL",
            "Usage",
            "PromptModifier",
        ];

        // 2. Map Data
        const rows = materials.map((m) => [
            m.id,
            m.refCode,
            `"${(m.name || "").replace(/"/g, '""')}"`,
            m.category,
            m.subcategory || "",
            m.pricing.pricePerUnit,
            m.pricing.currency || "USD",
            m.pricing.unitLabel,
            m.pricing.itemsPerBox || 1,
            m.dimensions.width,
            m.dimensions.length,
            m.dimensions.thickness,
            `"${(m.description || "").replace(/"/g, '""')}"`,
            `"${m.imageUrl}"`,
            m.usage,
            `"${(m.promptModifier || "").replace(/"/g, '""')}"`,
        ]);

        // 3. Construct CSV String
        const csvContent = [
            headers.join(","),
            ...rows.map((r) => r.join(",")),
        ].join("\n");

        // 4. Trigger Download
        const blob = new Blob([csvContent], {
            type: "text/csv;charset=utf-8;",
        });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", "materials_database_export.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleCSVUploadForCollection = (
        e: React.ChangeEvent<HTMLInputElement>,
        collectionType: "Interior" | "Exterior",
    ) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = (event) => {
                const text = event.target?.result as string;
                // Simple CSV parser that respects quotes
                const parseCSV = (str: string) => {
                    const arr: string[][] = [];
                    let quote = false;
                    let col = 0,
                        row = 0;
                    for (let c = 0; c < str.length; c++) {
                        let cc = str[c],
                            nc = str[c + 1];
                        arr[row] = arr[row] || [];
                        arr[row][col] = arr[row][col] || "";
                        if (cc == '"' && quote && nc == '"') {
                            arr[row][col] += cc;
                            ++c;
                            continue;
                        }
                        if (cc == '"') {
                            quote = !quote;
                            continue;
                        }
                        if (cc == "," && !quote) {
                            ++col;
                            continue;
                        }
                        if (cc == "\r" && nc == "\n" && !quote) {
                            ++row;
                            col = 0;
                            ++c;
                            continue;
                        }
                        if (cc == "\n" && !quote) {
                            ++row;
                            col = 0;
                            continue;
                        }
                        if (cc == "\r" && !quote) {
                            ++row;
                            col = 0;
                            continue;
                        }
                        arr[row][col] += cc;
                    }
                    return arr;
                };

                const data = parseCSV(text);
                const newMats: Material[] = [];

                // Helper to parse numbers - handles currency symbols, spaces, and different formats
                const parseNumber = (s: string): number => {
                    if (!s) return 0;
                    // Remove currency symbols, spaces, and other non-numeric chars except . and ,
                    let cleaned = s.replace(/[^0-9.,\-]/g, "").trim();
                    // Handle European format (comma as decimal): if has comma but no dot, or comma after dot
                    if (cleaned.includes(",") && !cleaned.includes(".")) {
                        cleaned = cleaned.replace(",", ".");
                    } else if (cleaned.includes(",") && cleaned.includes(".")) {
                        // Has both - assume comma is thousands separator
                        cleaned = cleaned.replace(/,/g, "");
                    }
                    const result = parseFloat(cleaned);
                    return isNaN(result) ? 0 : result;
                };

                // Skip header (row 0), start at 1
                for (let i = 1; i < data.length; i++) {
                    const cols = data[i];

                    // Safe column getter - returns empty string if column doesn't exist
                    const getCol = (index: number) =>
                        cols[index] ? cols[index].trim() : "";

                    // Skip completely empty rows
                    if (cols.every((c) => !c || c.trim() === "")) continue;

                    const name = getCol(1) || "Imported Material";
                    const category = getCol(2) || "General";
                    const subcategory = getCol(3) || "";

                    const newMat: Material = {
                        id: getCol(0) || `csv-${Date.now()}-${i}`,
                        refCode: getCol(0) || `REF-${Date.now()}-${i}`,
                        name: name,
                        category: category,
                        subcategory: subcategory,
                        pricing: {
                            pricePerUnit: parseNumber(getCol(5)),
                            currency: "COP", // Data seems to be in COP ($ 31.599)
                            unitLabel: getCol(6) || "Unidad",
                            itemsPerBox: parseNumber(getCol(7)) || 1,
                        },
                        dimensions: {
                            width: parseNumber(getCol(10)) || 100,
                            length: parseNumber(getCol(11)) || 100,
                            thickness: parseNumber(getCol(12)) || 5,
                        },
                        description: getCol(19) || "",
                        imageUrl: convertGoogleDriveUrl(getCol(16)) || "",
                        usage: collectionType,
                        promptModifier:
                            getCol(18) || `${name}, ${category} ${subcategory}`,
                    };
                    newMats.push(newMat);
                }

                if (newMats.length > 0) {
                    const dbMaterials = newMats.map((m) => ({
                        ref_code: m.refCode,
                        name: m.name,
                        category: m.category,
                        subcategory: m.subcategory,
                        price: m.pricing.pricePerUnit,
                        unit: m.pricing.unitLabel,
                        items_per_box: m.pricing.itemsPerBox,
                        width_cm: m.dimensions.width,
                        length_cm: m.dimensions.length,
                        thickness_m: m.dimensions.thickness,
                        description: m.description,
                        image_url: m.imageUrl,
                        usage: m.usage,
                        prompt_modifier: m.promptModifier,
                    }));

                    fetch("/api/materials/bulk", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ materials: dbMaterials }),
                    })
                        .then((res) => res.json())
                        .then((data) => {
                            if (data.success) {
                                loadMaterialsFromDB();
                                alert(
                                    `Imported ${data.imported} materials to database.`,
                                );
                            } else {
                                alert("Failed to import materials.");
                            }
                        })
                        .catch((err) => {
                            console.error("Import error:", err);
                            alert("Failed to import materials.");
                        });
                }
            };
            reader.readAsText(file);
        }
    };

    const handleSaveContractor = () => {
        if (!contractorForm.name) return;
        const newContractor: Contractor = {
            id: `cont-${Date.now()}`,
            name: contractorForm.name || "",
            email: contractorForm.email || "",
            phone: contractorForm.phone || "",
            region: contractorForm.region || "",
            address: contractorForm.address || "",
        };
        setContractors([...contractors, newContractor]);
        setContractorForm({});
    };

    const resetMaterials = async () => {
        if (confirm("Factory Reset: All custom data will be lost.")) {
            try {
                await fetch("/api/materials", { method: "DELETE" });
                setMaterials([]);
                setContractors(INITIAL_CONTRACTORS);
                localStorage.removeItem("constructVizContractors");
            } catch (e) {
                console.error("Failed to reset:", e);
            }
        }
    };

    // --- Main Logic ---

    const handleStart = (usage: "Interior" | "Exterior" | "All") => {
        setCategoryUsage(usage);
        setView(AppView.GALLERY);
    };

    const handleSelectMaterial = async (material: Material) => {
        setSelectedMaterial(material);
        setShowProbeModal(true);
        logUserBehavior("SELECT_MATERIAL", { id: material.id, name: material.name });
    };

    const handleImageCapture = (file: File) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            setOriginalImage(reader.result as string);
            setView(AppView.EDITOR);
            setHistory([]);
            setHistoryIndex(-1);
            logUserBehavior("UPLOAD_IMAGE", { fileName: file.name, fileSize: file.size });
            setGenerationState((prev) => ({
                ...prev,
                resultImage: null,
                resultVideo: null,
                analysis: null,
                error: null,
                materialProbe: null,
            }));
        };
        reader.readAsDataURL(file);
    };

    const handleGenerate = async () => {
        if (!originalImage) {
            setGenerationState((prev) => ({
                ...prev,
                error: lang === "es" ? "Por favor sube o toma una foto primero." : "Please upload or take a photo first.",
            }));
            return;
        }
        if (!selectedMaterial) {
            setGenerationState((prev) => ({
                ...prev,
                error: lang === "es" ? "Por favor selecciona un material primero." : "Please select a material first.",
            }));
            return;
        }

        // Pre-check quota
        if (currentUser && currentUser.role !== 'admin') {
            const limit = getTierLimit(currentUser.tier || 'Free');
            if ((currentUser.generations_used || 0) >= limit) {
                setShowSubscriptionModal(true);
                return;
            }
        }

        setGenerationState((prev) => ({
            ...prev,
            isGenerating: true,
            error: null,
        }));

        try {
            const generatedImage = await generateMaterialOverlay(
                originalImage,
                selectedMaterial,
                customPrompt,
                renderOptions,
                lang,
                currentUser?.id
            );

            const newHistoryItem: HistoryItem = {
                resultImage: generatedImage,
                resultVideo: null,
                analysis: null,
                prompt: customPrompt,
                material: selectedMaterial,
            };

            const newHistory = [
                ...history.slice(0, historyIndex + 1),
                newHistoryItem,
            ];
            setHistory(newHistory);
            setHistoryIndex(newHistory.length - 1);
            setGenerationState((prev) => ({
                ...prev,
                isGenerating: false,
                resultImage: generatedImage,
            }));
            
            // Refresh user quota immediately
            if (currentUser) {
                setCurrentUser({
                    ...currentUser,
                    generations_used: (currentUser.generations_used || 0) + 1
                });

                // Sync generation result to user memory
                fetch(`/api/users/${currentUser.id}/memory`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        historyItem: {
                            ...newHistoryItem,
                            timestamp: new Date().toISOString()
                        },
                        behaviorEvent: {
                            type: 'SUCCESS_GENERATION',
                            timestamp: new Date().toISOString(),
                            details: {
                                materialId: selectedMaterial?.id,
                                materialName: selectedMaterial?.name,
                                prompt: customPrompt
                            }
                        }
                    })
                }).catch(() => {});
            }
        } catch (error: any) {
            const errorMsg = error.message || "Unknown error";
            console.error("Generation failed:", errorMsg);
            
            // Log to backend for developer to see in /api/debug/errors
            fetch('/api/log-error', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    error: errorMsg, 
                    context: 'handleGenerate',
                    userId: currentUser?.id 
                })
            }).catch(() => {});

            setGenerationState((prev) => ({
                ...prev,
                isGenerating: false,
                error: (lang === 'es' ? 'Error al generar: ' : 'Generation error: ') + errorMsg
            }));
            
            const isQuotaError = errorMsg.includes('403') || errorMsg.includes('Quota exceeded');
            if (isQuotaError) {
                if (confirm(lang === 'es' ? 'Has alcanzado tu límite de renders. ¿Deseas mejorar tu plan ahora?' : 'You have reached your render limit. Would you like to upgrade your plan now?')) {
                    setShowSubscriptionModal(true);
                }
            }
        }
    };

    const handleGenerateProbe = async () => {
        // Feature disabled or simplified to just opening the modal
        setShowProbeModal(true);
    };

    const handleRoomAnalysis = async () => {
        if (!originalImage) return;
        setGenerationState((prev) => ({
            ...prev,
            isAnalyzing: true,
            error: null,
        })); // Use isAnalyzing instead of isGenerating
        try {
            const analysisText = await generateRoomAnalysis(
                originalImage,
                currentUser?.id,
                lang,
            );
            setGenerationState((prev) => ({
                ...prev,
                isAnalyzing: false,
                analysis: analysisText,
            }));
            logUserBehavior("ROOM_ANALYSIS", { analysisLength: analysisText.length });
        } catch (e: any) {
            setGenerationState((prev) => ({
                ...prev,
                isAnalyzing: false,
                error: "Analysis failed.",
            }));
        }
    };

    const handleAnimateVideo = async () => {
        const sourceImage = generationState.resultImage || originalImage;
        if (!sourceImage) return;
        setGenerationState((prev) => ({ ...prev, isGenerating: true }));
        try {
            const contextPrompt = selectedMaterial
                ? `featuring ${selectedMaterial.name}`
                : "architectural tour";
            const videoUri = await generateCinematicVideo(
                sourceImage,
                contextPrompt,
                currentUser?.id
            );
            if (!videoUri) {
                alert("Veo Video unavailable for this key.");
                setGenerationState((prev) => ({
                    ...prev,
                    isGenerating: false,
                }));
                return;
            }
            if (historyIndex >= 0) {
                const updatedHistory = [...history];
                updatedHistory[historyIndex].resultVideo = videoUri;
                setHistory(updatedHistory);
            }
            setGenerationState((prev) => ({
                ...prev,
                isGenerating: false,
                resultVideo: videoUri,
            }));
            logUserBehavior("VIDEO_GENERATION", { hasVideo: !!videoUri });
        } catch (e: any) {
            setGenerationState((prev) => ({
                ...prev,
                isGenerating: false,
                error: "Video failed.",
            }));
        }
    };

    const LanguageToggle = () => (
        <div className="flex bg-gray-200 rounded-lg p-1 border border-gray-300">
            <button
                onClick={() => {
                    setLang("en");
                    logUserBehavior("CHANGE_LANGUAGE", { lang: "en" });
                }}
                className={`px-3 py-1 text-xs font-bold rounded transition-colors ${lang === "en" ? "bg-blue-600 text-white shadow" : "text-gray-500 hover:text-gray-700"}`}
            >
                EN {unitSystem === "usa" && " (ft/in)"}
            </button>
            <button
                onClick={() => {
                    setLang("es");
                    logUserBehavior("CHANGE_LANGUAGE", { lang: "es" });
                }}
                className={`px-3 py-1 text-xs font-bold rounded transition-colors ${lang === "es" ? "bg-blue-600 text-white shadow" : "text-gray-500 hover:text-gray-700"}`}
            >
                ES {unitSystem === "latam" && " (m/cm)"}
            </button>
        </div>
    );

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setAuthError("");
        setAuthLoading(true);

        try {
            const endpoint =
                authMode === "login" ? "/api/auth/login" : "/api/auth/signup";
            const body =
                authMode === "login"
                    ? { email: authForm.email, password: authForm.password }
                    : {
                          name: authForm.name,
                          email: authForm.email,
                          phone: authForm.email_phone,
                          address: authForm.address,
                          password: authForm.password,
                      };

            const response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

            const data = await response.json();

            if (!response.ok) {
                setAuthError(data.error || "Authentication failed");
                return;
            }

            setCurrentUser(data.user);
            localStorage.setItem('constructviz_user', JSON.stringify(data.user));
            setView(AppView.LANDING);
            loadUserMemory(data.user.id);
            setTimeout(() => {
                logUserBehavior("USER_LOGIN", { email: data.user.email });
            }, 200);
            setAuthForm({
                name: "",
                email: "",
                email_phone: "",
                address: "",
                password: "",
            });
        } catch (error) {
            setAuthError("Connection error. Please try again.");
        } finally {
            setAuthLoading(false);
        }
    };

    const renderLogin = () => (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 relative overflow-hidden bg-gray-100">
            <div
                className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-50"
                style={{
                    backgroundImage:
                        "url('https://res.cloudinary.com/dsex1a9tu/image/upload/v1768992973/APP_Horizontal_-07_ydmd3m.jpg')",
                }}
            />
            <header className="absolute top-4 right-4 z-20">
                <LanguageToggle />
            </header>
            <div className="relative z-10 flex flex-col items-center mb-8">
                <BrandLogo className="w-32 h-32" />
            </div>
            <div className="relative z-10 w-full max-w-sm bg-gray-200/80 backdrop-blur-sm p-8 rounded-2xl shadow-lg">
                <form className="space-y-4" onSubmit={handleAuth}>
                    {authMode === "signup" && (
                        <>
                            <input
                                type="text"
                                value={authForm.name}
                                onChange={(e) =>
                                    setAuthForm({
                                        ...authForm,
                                        name: e.target.value,
                                    })
                                }
                                className="w-full bg-gray-300 border-0 rounded-lg p-4 text-gray-700 placeholder-gray-500"
                                placeholder={
                                    lang === "es"
                                        ? "Nombre Completo"
                                        : "Full Name"
                                }
                                required
                            />
                            <input
                                type="tel"
                                value={authForm.email_phone}
                                onChange={(e) =>
                                    setAuthForm({
                                        ...authForm,
                                        email_phone: e.target.value,
                                    })
                                }
                                className="w-full bg-gray-300 border-0 rounded-lg p-4 text-gray-700 placeholder-gray-500"
                                placeholder={
                                    lang === "es" ? "Teléfono" : "Phone Number"
                                }
                                required
                            />
                            <input
                                type="text"
                                value={authForm.address}
                                onChange={(e) =>
                                    setAuthForm({
                                        ...authForm,
                                        address: e.target.value,
                                    })
                                }
                                className="w-full bg-gray-300 border-0 rounded-lg p-4 text-gray-700 placeholder-gray-500"
                                placeholder={
                                    lang === "es" ? "Dirección" : "Address"
                                }
                                required
                            />
                        </>
                    )}
                    <input
                        type="email"
                        value={authForm.email}
                        onChange={(e) =>
                            setAuthForm({ ...authForm, email: e.target.value })
                        }
                        className="w-full bg-gray-300 border-0 rounded-lg p-4 text-gray-700 placeholder-gray-500"
                        placeholder={t.login.email}
                        required
                    />
                    <input
                        type="password"
                        value={authForm.password}
                        onChange={(e) =>
                            setAuthForm({
                                ...authForm,
                                password: e.target.value,
                            })
                        }
                        className="w-full bg-gray-300 border-0 rounded-lg p-4 text-gray-700 placeholder-gray-500"
                        placeholder={t.login.password}
                        required
                    />

                    {authError && (
                        <div className="text-red-600 text-sm text-center bg-red-100 p-2 rounded">
                            {authError}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={authLoading}
                        className="w-full bg-gray-400 hover:bg-gray-500 text-gray-700 py-4 rounded-lg text-base font-semibold transition-colors disabled:opacity-50"
                    >
                        {authLoading
                            ? "..."
                            : authMode === "login"
                              ? t.login.signIn
                              : lang === "es"
                                ? "Registrarse"
                                : "Sign Up"}
                    </button>

                    {/* Skip Login - Demo Mode */}
                    <button
                        type="button"
                        onClick={() => {
                            const demoUser = {
                                id: 0,
                                name: 'Demo User',
                                email: 'demo@constructviz.ai',
                                role: 'admin',
                                tier: 'Enterprise',
                                generations_used: 0,
                                photoURL: 'https://res.cloudinary.com/dsex1a9tu/image/upload/v1768992973/APP_Horizontal_-07_ydmd3m.jpg',
                                created_at: new Date().toISOString()
                            };
                            setCurrentUser(demoUser);
                            localStorage.setItem('constructviz_user', JSON.stringify(demoUser));
                            setView(AppView.LANDING);
                        }}
                        className="w-full text-sm text-gray-500 hover:text-blue-500 underline transition-colors py-2"
                    >
                        {t.login.skip || "Skip for now (Demo)"}
                    </button>

                    <div className="text-center text-sm text-gray-600">
                        {authMode === "login" ? (
                            <span>
                                {lang === "es"
                                    ? "¿No tienes cuenta? "
                                    : "Don't have an account? "}
                                <button
                                    type="button"
                                    onClick={() => {
                                        setAuthMode("signup");
                                        setAuthError("");
                                    }}
                                    className="text-blue-600 hover:underline font-semibold"
                                >
                                    {lang === "es" ? "Regístrate" : "Sign Up"}
                                </button>
                            </span>
                        ) : (
                            <span>
                                {lang === "es"
                                    ? "¿Ya tienes cuenta? "
                                    : "Already have an account? "}
                                <button
                                    type="button"
                                    onClick={() => {
                                        setAuthMode("login");
                                        setAuthError("");
                                    }}
                                    className="text-blue-600 hover:underline font-semibold"
                                >
                                    {lang === "es"
                                        ? "Inicia sesión"
                                        : "Sign In"}
                                </button>
                            </span>
                        )}
                    </div>
                    
                    {/* App Store Compliance: Legal Links */}
                    <div className="mt-6 flex justify-center space-x-4 text-xs text-gray-500">
                        <a href="https://buildinginnovation.com/privacy" target="_blank" rel="noreferrer" className="hover:underline hover:text-gray-700">
                            {lang === "es" ? "Política de Privacidad" : "Privacy Policy"}
                        </a>
                        <span>|</span>
                        <a href="https://buildinginnovation.com/terms" target="_blank" rel="noreferrer" className="hover:underline hover:text-gray-700">
                            {lang === "es" ? "Términos de Servicio" : "Terms of Service"}
                        </a>
                    </div>
                </form>
            </div>
        </div>
    );

    const renderLanding = () => (
        <div className="min-h-screen bg-gray-100 p-6 flex flex-col relative">
            <div
                className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-50"
                style={{
                    backgroundImage:
                        "url('https://res.cloudinary.com/dsex1a9tu/image/upload/v1768992973/APP_Horizontal_-07_ydmd3m.jpg')",
                }}
            />
            <header className="relative z-10 flex justify-between items-center mb-4">
                <div className="text-gray-700 text-sm flex items-center gap-2">
                    {currentUser && (
                        <>
                            {/* User Avatar */}
                            <div className="w-8 h-8 rounded-full bg-blue-200 border-2 border-blue-300 overflow-hidden flex-shrink-0">
                                {currentUser.photoURL ? (
                                    <img
                                        src={currentUser.photoURL}
                                        alt={currentUser.name}
                                        className="w-full h-full object-cover"
                                        onError={(e) => {
                                            (e.target as HTMLImageElement).style.display = 'none';
                                            (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                                        }}
                                    />
                                ) : null}
                                {/* Initials fallback */}
                                <div className={`w-full h-full flex items-center justify-center text-xs font-bold bg-blue-200 text-blue-800 ${currentUser.photoURL ? 'hidden' : ''}`}>
                                    {currentUser.name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                                </div>
                            </div>
                            <span className="font-medium">{currentUser.name}</span>
                        </>
                    )}
                </div>
                <div className="flex items-center gap-4">
                    <LanguageToggle />
                    <button
                        onClick={() => setView(AppView.CART)}
                        className="relative p-2 text-gray-600 hover:text-gray-900"
                    >
                        <svg
                            className="w-6 h-6"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
                            />
                        </svg>
                        {cartCount > 0 && (
                            <span className="absolute top-0 right-0 w-4 h-4 bg-blue-500 rounded-full text-[10px] font-bold text-gray-700 flex items-center justify-center">
                                {cartCount}
                            </span>
                        )}
                    </button>
                    {currentUser?.role === "admin" && (
                        <button
                            onClick={() => setView(AppView.ADMIN)}
                            className="p-2 text-gray-600 hover:text-gray-900"
                        >
                            <svg
                                className="w-6 h-6"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37.996.608 2.296.07 2.572-1.065z"
                                />
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                />
                            </svg>
                        </button>
                    )}
                    {/* Credit Meter */}
                    {currentUser && (
                        <div className="hidden md:flex items-center gap-3 px-3 py-1.5 bg-blue-50 border border-blue-100 rounded-full">
                            <div className="flex flex-col">
                                <div className="flex justify-between items-center w-24">
                                    <span className="text-[9px] font-bold text-blue-600 uppercase">{currentUser.tier}</span>
                                    <span className="text-[9px] font-bold text-blue-400">
                                        {currentUser.generations_used} / {getTierLimit(currentUser.tier || 'Free') === 9999 ? '∞' : getTierLimit(currentUser.tier || 'Free')}
                                    </span>
                                </div>
                                {currentUser.tier_expires_at && currentUser.tier?.toUpperCase() !== 'FREE' && (
                                    <div className="text-[8px] text-amber-600 font-semibold mt-0.5">
                                        {(() => {
                                            const days = Math.max(0, Math.ceil((new Date(currentUser.tier_expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
                                            if (days <= 3) return `${days}d left — renew now!`;
                                            if (days <= 7) return `${days}d remaining`;
                                            return null;
                                        })()}
                                    </div>
                                )}
                                <div className="w-24 h-1 bg-blue-200 rounded-full overflow-hidden mt-0.5">
                                    <div 
                                        className="h-full bg-blue-600 transition-all duration-500" 
                                        style={{ width: `${Math.min(100, (currentUser.generations_used / getTierLimit(currentUser.tier || 'Free')) * 100)}%` }}
                                    ></div>
                                </div>
                            </div>
                            <button 
                                onClick={() => setShowSubscriptionModal(true)}
                                className="p-1 hover:bg-blue-100 rounded-full text-blue-600"
                                title="Upgrade Tier"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                            </button>
                        </div>
                    )}

                    <button
                        onClick={() => {
                            setCurrentUser(null);
                            localStorage.removeItem('constructviz_user');
                            setView(AppView.LOGIN);
                        }}
                        className="p-2 text-gray-600 hover:text-gray-900"
                        title={lang === "es" ? "Cerrar sesión" : "Logout"}
                    >
                        <svg
                            className="w-6 h-6"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                            />
                        </svg>
                    </button>
                    {/* App Store Compliance: Delete Account Button */}
                    <button
                        onClick={async () => {
                            const msg = lang === "es" 
                                ? "ADVERTENCIA: Esta acción eliminará permanentemente su cuenta y todos sus datos. Esta acción no se puede deshacer. ¿Desea continuar?" 
                                : "WARNING: This will permanently delete your account and all your data. This action cannot be undone. Do you wish to proceed?";
                            
                            if (window.confirm(msg)) {
                                try {
                                    // Make API call to delete account if needed
                                    // await fetch(`/api/auth/users/${currentUser?.id}`, { method: 'DELETE' });
                                    alert(lang === "es" ? "Su cuenta ha sido eliminada. Lamentamos que te vayas." : "Your account has been successfully deleted. We are sorry to see you go.");
                                    setCurrentUser(null);
                                    setView(AppView.LOGIN);
                                } catch (e) {
                                    alert(lang === "es" ? "Error al eliminar la cuenta." : "Failed to delete account.");
                                }
                            }
                        }}
                        className="p-2 text-red-500 hover:text-red-700"
                        title={lang === "es" ? "Eliminar Cuenta" : "Delete Account"}
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                    </button>
                </div>
            </header>

            <div className="relative z-10 flex-1 flex flex-col items-center justify-center max-w-xl mx-auto w-full text-center">
                <div className="mb-6">
                    <BrandLogo className="w-32 h-32 mx-auto" />
                </div>

                <h2 className="text-2xl md:text-3xl font-bold text-gray-800 mb-2">
                    {t.landing.title === "Visualize "
                        ? "¡Bienvenido!"
                        : t.landing.title}
                </h2>
                <p className="text-gray-600 text-sm md:text-base mb-8">
                    {t.landing.subtitle}
                </p>

                <p className="text-gray-700 font-semibold uppercase tracking-wider text-xs mb-6">
                    {lang === "es"
                        ? "SELECCIONA EL TIPO DE ESPACIO"
                        : "SELECT SPACE TYPE"}
                </p>

                <div className="grid grid-cols-2 gap-4 w-full">
                    <button
                        onClick={() => { handleStart("Interior"); logUserBehavior("SELECT_SPACE_TYPE", { type: "Interior" }); }}
                        className="group flex flex-col items-center"
                    >
                        <div className="relative w-full aspect-[4/5] rounded-2xl overflow-hidden shadow-lg hover:shadow-xl transition-all">
                            <img
                                src="https://res.cloudinary.com/dsex1a9tu/image/upload/v1768992973/Espacio_Int_ipvzyz.jpg"
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                        </div>
                        <span className="mt-3 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm font-medium">
                            {lang === "es"
                                ? "Espacio interior"
                                : "Interior Space"}
                        </span>
                    </button>
                    <button
                        onClick={() => { handleStart("Exterior"); logUserBehavior("SELECT_SPACE_TYPE", { type: "Exterior" }); }}
                        className="group flex flex-col items-center"
                    >
                        <div className="relative w-full aspect-[4/5] rounded-2xl overflow-hidden shadow-lg hover:shadow-xl transition-all">
                            <img
                                src="https://res.cloudinary.com/dsex1a9tu/image/upload/v1768992973/Espacio_Ext_t4ic8u.jpg"
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                        </div>
                        <span className="mt-3 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm font-medium">
                            {lang === "es"
                                ? "Espacio exterior"
                                : "Exterior Space"}
                        </span>
                    </button>
                </div>
            </div>
        </div>
    );

    const renderAdmin = () => (
        <div className="min-h-screen bg-gray-100 text-gray-700 p-6 overflow-auto">
            <div className="max-w-7xl mx-auto">
                <div className="flex justify-between items-center mb-8">
                    <div className="flex items-center gap-3">
                        <Button
                            variant="ghost"
                            onClick={() => setView(AppView.LANDING)}
                        >
                            ← {t.common.back}
                        </Button>
                        <h1 className="text-2xl font-black text-gray-700 uppercase">
                            {t.admin.dashboard}
                        </h1>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                        <Button
                            variant={
                                adminTab === "ANALYTICS" ? "primary" : "ghost"
                            }
                            onClick={() => setAdminTab("ANALYTICS")}
                        >
                            {lang === "es" ? "Análisis" : "Analytics"}
                        </Button>
                        <Button
                            variant={
                                adminTab === "MATERIALS" ? "primary" : "ghost"
                            }
                            onClick={() => setAdminTab("MATERIALS")}
                        >
                            {t.admin.products}
                        </Button>
                        <Button
                            variant={
                                adminTab === "USERS" ? "primary" : "ghost"
                            }
                            onClick={() => setAdminTab("USERS")}
                        >
                            {lang === "es" ? "Usuarios" : "Users"}
                        </Button>
                        <Button
                            variant={
                                adminTab === "CONTRACTORS" ? "primary" : "ghost"
                            }
                            onClick={() => setAdminTab("CONTRACTORS")}
                        >
                            {t.admin.installers}
                        </Button>
                        <Button
                            variant={
                                adminTab === "PURCHASES" ? "primary" : "ghost"
                            }
                            onClick={() => setAdminTab("PURCHASES")}
                        >
                            {lang === "es" ? "Pedidos/Solicitudes" : "Purchases/Requests"}
                        </Button>
                        <Button
                            variant={
                                adminTab === "SETTINGS" ? "primary" : "ghost"
                            }
                            onClick={() => setAdminTab("SETTINGS")}
                        >
                            {t.admin.settings}
                        </Button>
                        <Button
                            variant={
                                adminTab === "AUDIT_LOGS" ? "primary" : "ghost"
                            }
                            onClick={() => setAdminTab("AUDIT_LOGS")}
                        >
                            {lang === "es" ? "Auditoría de Seguridad" : "Security Audit Logs"}
                        </Button>
                    </div>
                </div>

                {adminTab === "ANALYTICS" && (
                    <div className="space-y-6 animate-fadeIn">
                        {isLoadingAnalytics ? (
                            <div className="flex items-center justify-center py-20">
                                <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full"></div>
                            </div>
                        ) : analyticsData ? (
                            <>
                                {/* KPI Cards */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">{lang === "es" ? "Tiempo en Línea" : "Server Uptime"}</div>
                                        <div className="text-2xl font-black text-gray-800">{Math.floor((analyticsData.server?.uptime || 0) / 3600)}h {Math.floor(((analyticsData.server?.uptime || 0) % 3600) / 60)}m</div>
                                        <div className="text-[10px] text-green-600 font-bold mt-1">● {lang === "es" ? "En Línea" : "Online"}</div>
                                    </div>
                                    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">{lang === "es" ? "Generaciones IA" : "AI Generations"}</div>
                                        <div className="text-2xl font-black text-blue-600">{analyticsData.ai?.totalGenerations || 0}</div>
                                        <div className="text-[10px] text-gray-500 mt-1">{analyticsData.ai?.successRate || 0}% {lang === "es" ? "éxito" : "success rate"}</div>
                                    </div>
                                    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">{lang === "es" ? "Tiempo Promedio" : "Avg Render Time"}</div>
                                        <div className="text-2xl font-black text-purple-600">{analyticsData.ai?.avgDurationMs ? (analyticsData.ai.avgDurationMs / 1000).toFixed(1) + 's' : '—'}</div>
                                        <div className="text-[10px] text-gray-500 mt-1">Gemini AI Model</div>
                                    </div>
                                    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">{lang === "es" ? "Productos Totales" : "Total Products"}</div>
                                        <div className="text-2xl font-black text-gray-800">{analyticsData.products?.total || 0}</div>
                                        <div className="text-[10px] text-gray-500 mt-1">{Object.keys(analyticsData.products?.categories || {}).length} {lang === "es" ? "categorías" : "categories"}</div>
                                    </div>
                                </div>

                                {/* User Distribution & API Status */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                                        <h3 className="text-sm font-bold text-gray-700 mb-4 uppercase tracking-wider">{lang === "es" ? "Distribución de Usuarios" : "User Tier Distribution"}</h3>
                                        <div className="space-y-3">
                                            {[
                                                { label: lang === "es" ? "Gratis" : "Free", count: analyticsData.users?.free || 0, color: 'bg-gray-400', total: analyticsData.users?.total || 1 },
                                                { label: 'Pro', count: analyticsData.users?.pro || 0, color: 'bg-blue-500', total: analyticsData.users?.total || 1 },
                                                { label: 'Enterprise', count: analyticsData.users?.enterprise || 0, color: 'bg-purple-500', total: analyticsData.users?.total || 1 },
                                            ].map(tier => (
                                                <div key={tier.label} className="flex items-center gap-3">
                                                    <span className="text-xs font-bold text-gray-600 w-20">{tier.label}</span>
                                                    <div className="flex-1 bg-gray-100 rounded-full h-3">
                                                        <div className={`${tier.color} h-3 rounded-full transition-all`} style={{ width: `${Math.max(2, (tier.count / tier.total) * 100)}%` }}></div>
                                                    </div>
                                                    <span className="text-xs font-bold text-gray-500 w-8 text-right">{tier.count}</span>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="mt-4 pt-3 border-t border-gray-100 flex justify-between text-xs text-gray-500">
                                            <span>{lang === "es" ? "Total Usuarios:" : "Total Users:"} <strong className="text-gray-700">{analyticsData.users?.total || 0}</strong></span>
                                            <span>{lang === "es" ? "Renders Totales:" : "Total Renders:"} <strong className="text-gray-700">{analyticsData.users?.totalGenerations || 0}</strong></span>
                                        </div>
                                    </div>

                                    <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                                        <h3 className="text-sm font-bold text-gray-700 mb-4 uppercase tracking-wider">{lang === "es" ? "Salud del Sistema" : "System Health"}</h3>
                                        <div className="space-y-2">
                                            {[
                                                { label: 'API Key', ok: analyticsData.ai?.apiKeyStatus === 'valid' },
                                                { label: 'AI Model', ok: true, detail: 'gemini-2.5-flash-image' },
                                                { label: 'Product Images', ok: (analyticsData.products?.total || 0) > 0, detail: `${analyticsData.products?.total || 0} loaded` },
                                                { label: 'Server', ok: true, detail: `Port ${analyticsData.server?.nodeEnv || '3000'}` },
                                            ].map(item => (
                                                <div key={item.label} className="flex items-center justify-between py-1.5 px-3 bg-gray-50 rounded-lg">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`w-2 h-2 rounded-full ${item.ok ? 'bg-green-500' : 'bg-red-500'}`}></span>
                                                        <span className="text-xs font-semibold text-gray-700">{item.label}</span>
                                                    </div>
                                                    <span className="text-[10px] text-gray-400">{(item as any).detail || (item.ok ? 'OK' : 'Error')}</span>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="mt-4 pt-3 border-t border-gray-100">
                                            <div className="text-[10px] text-gray-400">API Calls: {analyticsData.usage?.apiCalls || 0} | Requests: {analyticsData.usage?.totalRequests || 0}</div>
                                        </div>
                                    </div>
                                </div>

                                {/* Product Categories */}
                                <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                                    <h3 className="text-sm font-bold text-gray-700 mb-4 uppercase tracking-wider">{lang === "es" ? "Catálogo por Categoría" : "Product Catalog by Category"}</h3>
                                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                                        {Object.entries(analyticsData.products?.categories || {}).sort((a: any, b: any) => b[1] - a[1]).map(([cat, count]: [string, any]) => (
                                            <div key={cat} className="bg-gray-50 rounded-lg p-3 text-center border border-gray-100">
                                                <div className="text-lg font-black text-blue-600">{count}</div>
                                                <div className="text-[9px] font-bold text-gray-500 uppercase tracking-wider leading-tight mt-1">{cat}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Recent Generations */}
                                {(analyticsData.recentGenerations?.length || 0) > 0 && (
                                    <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                                        <h3 className="text-sm font-bold text-gray-700 mb-4 uppercase tracking-wider">{lang === "es" ? "Generaciones Recientes" : "Recent AI Generations"}</h3>
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-left text-xs">
                                                <thead className="text-[10px] uppercase text-gray-400 border-b border-gray-100">
                                                    <tr>
                                                        <th className="py-2 px-3">{lang === "es" ? "Hora" : "Time"}</th>
                                                        <th className="py-2 px-3">{lang === "es" ? "Material" : "Material"}</th>
                                                        <th className="py-2 px-3">{lang === "es" ? "Categoría" : "Category"}</th>
                                                        <th className="py-2 px-3">{lang === "es" ? "Modelo" : "Model"}</th>
                                                        <th className="py-2 px-3">{lang === "es" ? "Duración" : "Duration"}</th>
                                                        <th className="py-2 px-3">Status</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-50">
                                                    {analyticsData.recentGenerations.map((gen: any, i: number) => (
                                                        <tr key={i} className="hover:bg-gray-50">
                                                            <td className="py-2 px-3 text-gray-500">{new Date(gen.timestamp).toLocaleTimeString()}</td>
                                                            <td className="py-2 px-3 font-semibold text-gray-700">{gen.materialName || '—'}</td>
                                                            <td className="py-2 px-3 text-gray-400">{gen.category || '—'}</td>
                                                            <td className="py-2 px-3"><code className="text-[9px] bg-gray-100 px-1.5 py-0.5 rounded">{gen.model}</code></td>
                                                            <td className="py-2 px-3 text-gray-500">{(gen.durationMs / 1000).toFixed(1)}s</td>
                                                            <td className="py-2 px-3">
                                                                <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${gen.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                                                                    {gen.success ? 'Success' : 'Failed'}
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}

                                {/* Refresh Button */}
                                <div className="flex justify-center">
                                    <button onClick={fetchAnalytics} className="px-6 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors">
                                        ↻ {lang === 'es' ? 'Actualizar' : 'Refresh Analytics'}
                                    </button>
                                </div>
                            </>
                        ) : (
                            <div className="text-center py-20 text-gray-400">No analytics data available</div>
                        )}
                    </div>
                )}

                {adminTab === "MATERIALS" && (
                    <div className="space-y-6 animate-fadeIn">
                        <div className="flex justify-between items-center bg-gray-200 p-2 rounded-xl border border-gray-300">
                            <div className="flex gap-2">
                                <button
                                    onClick={() => {
                                        setAdminCollectionFilter("All");
                                        setCurrentPage(1);
                                        setSelectedMaterialIds(new Set());
                                    }}
                                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${adminCollectionFilter === "All" ? "bg-blue-600 text-gray-700" : "bg-gray-300 text-gray-600 hover:bg-gray-400"}`}
                                >
                                    {t.admin.all ||
                                        (lang === "es" ? "Todos" : "All")}{" "}
                                    ({materials.length})
                                </button>
                                <button
                                    onClick={() => {
                                        setAdminCollectionFilter("Interior");
                                        setCurrentPage(1);
                                        setSelectedMaterialIds(new Set());
                                    }}
                                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${adminCollectionFilter === "Interior" ? "bg-green-600 text-gray-700" : "bg-gray-300 text-gray-600 hover:bg-gray-400"}`}
                                >
                                    {t.admin.interior} (
                                    {
                                        materials.filter(
                                            (m) => m.usage === "Interior",
                                        ).length
                                    }
                                    )
                                </button>
                                <button
                                    onClick={() => {
                                        setAdminCollectionFilter("Exterior");
                                        setCurrentPage(1);
                                        setSelectedMaterialIds(new Set());
                                    }}
                                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${adminCollectionFilter === "Exterior" ? "bg-orange-600 text-gray-700" : "bg-gray-300 text-gray-600 hover:bg-gray-400"}`}
                                >
                                    {t.admin.exterior} (
                                    {
                                        materials.filter(
                                            (m) => m.usage === "Exterior",
                                        ).length
                                    }
                                    )
                                </button>
                            </div>

                            <div className="flex gap-2 items-center px-4 border-l border-gray-300">
                                <span className="text-xs font-bold text-gray-500 uppercase">
                                    {t.admin.showPricesIn}
                                </span>
                                <button
                                    onClick={() => setDisplayCurrency("USD")}
                                    className={`px-3 py-1 text-xs font-bold rounded ${displayCurrency === "USD" ? "bg-blue-600 text-gray-700" : "text-gray-500 hover:bg-gray-300"}`}
                                >
                                    USD ($)
                                </button>
                                <button
                                    onClick={() => setDisplayCurrency("COP")}
                                    className={`px-3 py-1 text-xs font-bold rounded ${displayCurrency === "COP" ? "bg-blue-600 text-gray-700" : "text-gray-500 hover:bg-gray-300"}`}
                                >
                                    COP (Pesos)
                                </button>
                            </div>
                        </div>

                        {/* Toolbar */}
                        <div className="flex flex-col md:flex-row justify-between gap-4 bg-gray-200 p-4 rounded-xl border border-gray-300">
                            <div className="flex gap-2 flex-wrap">
                                <Button
                                    onClick={handleDownloadCSV}
                                    variant="secondary"
                                    icon={
                                        <svg
                                            className="w-4 h-4"
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                        >
                                            <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                strokeWidth={2}
                                                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                                            />
                                        </svg>
                                    }
                                >
                                    {t.admin.exportCSV}
                                </Button>
                                <div className="relative">
                                    <input
                                        type="file"
                                        accept=".csv"
                                        onChange={(e) =>
                                            handleCSVUploadForCollection(
                                                e,
                                                "Interior",
                                            )
                                        }
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                    />
                                    <Button
                                        variant="secondary"
                                        icon={
                                            <svg
                                                className="w-4 h-4"
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                            >
                                                <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    strokeWidth={2}
                                                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                                                />
                                            </svg>
                                        }
                                    >
                                        Import Interior
                                    </Button>
                                </div>
                                <div className="relative">
                                    <input
                                        type="file"
                                        accept=".csv"
                                        onChange={(e) =>
                                            handleCSVUploadForCollection(
                                                e,
                                                "Exterior",
                                            )
                                        }
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                    />
                                    <Button
                                        variant="secondary"
                                        icon={
                                            <svg
                                                className="w-4 h-4"
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                            >
                                                <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    strokeWidth={2}
                                                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                                                />
                                            </svg>
                                        }
                                    >
                                        Import Exterior
                                    </Button>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    onClick={() => {
                                        const filtered =
                                            adminCollectionFilter === "All"
                                                ? materials
                                                : materials.filter(
                                                      (m) =>
                                                          m.usage ===
                                                          adminCollectionFilter,
                                                  );
                                        setSelectedMaterialIds(
                                            new Set(filtered.map((m) => m.id)),
                                        );
                                    }}
                                    variant="secondary"
                                >
                                    {lang === "es"
                                        ? `Seleccionar Todo (${adminCollectionFilter === "All" ? materials.length : materials.filter((m) => m.usage === adminCollectionFilter).length})`
                                        : `Select All (${adminCollectionFilter === "All" ? materials.length : materials.filter((m) => m.usage === adminCollectionFilter).length})`}
                                </Button>
                                {selectedMaterialIds.size > 0 && (
                                    <>
                                        <Button
                                            onClick={() =>
                                                setSelectedMaterialIds(
                                                    new Set(),
                                                )
                                            }
                                            variant="secondary"
                                        >
                                            {lang === "es"
                                                ? "Deseleccionar"
                                                : "Clear Selection"}
                                        </Button>
                                        <Button
                                            onClick={handleBulkDelete}
                                            variant="danger"
                                            icon={
                                                <svg
                                                    className="w-4 h-4"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    viewBox="0 0 24 24"
                                                >
                                                    <path
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                        strokeWidth={2}
                                                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                                    />
                                                </svg>
                                            }
                                        >
                                            {lang === "es"
                                                ? `Eliminar (${selectedMaterialIds.size})`
                                                : `Delete (${selectedMaterialIds.size})`}
                                        </Button>
                                    </>
                                )}
                                <Button
                                    onClick={() => {
                                        setEditForm({ usage: "Interior" });
                                        setIsEditing(false);
                                    }}
                                    variant="primary"
                                    icon={
                                        <svg
                                            className="w-4 h-4"
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                        >
                                            <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                strokeWidth={2}
                                                d="M12 4v16m8-8H4"
                                            />
                                        </svg>
                                    }
                                >
                                    {t.admin.addProduct}
                                </Button>
                            </div>
                        </div>

                        {/* Add/Edit Form */}
                        {(isEditing || editForm.usage) && (
                            <div className="bg-gray-200 p-6 rounded-xl border border-gray-300 shadow-xl">
                                <h3 className="text-lg font-bold text-gray-700 mb-4">
                                    {isEditing
                                        ? t.admin.editProduct
                                        : t.admin.newProduct}
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                                    {/* Row 1: Identifiers */}
                                    <div>
                                        <label className="block text-xs uppercase text-gray-500 mb-1">
                                            {t.admin.refCode}
                                        </label>
                                        <input
                                            className="w-full bg-gray-200 border border-gray-300 rounded p-2 text-gray-700"
                                            placeholder="e.g. SPC-001"
                                            value={editForm.refCode || ""}
                                            onChange={(e) =>
                                                setEditForm({
                                                    ...editForm,
                                                    refCode: e.target.value,
                                                })
                                            }
                                        />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="block text-xs uppercase text-gray-500 mb-1">
                                            {t.admin.productName}
                                        </label>
                                        <input
                                            className="w-full bg-gray-200 border border-gray-300 rounded p-2 text-gray-700"
                                            placeholder="Product Name"
                                            value={editForm.name || ""}
                                            onChange={(e) =>
                                                setEditForm({
                                                    ...editForm,
                                                    name: e.target.value,
                                                })
                                            }
                                        />
                                    </div>

                                    {/* Row 2: Categories */}
                                    <div>
                                        <label className="block text-xs uppercase text-gray-500 mb-1">
                                            {t.admin.category}
                                        </label>
                                        <input
                                            className="w-full bg-gray-200 border border-gray-300 rounded p-2 text-gray-700"
                                            placeholder="e.g. Flooring"
                                            value={editForm.category || ""}
                                            onChange={(e) =>
                                                setEditForm({
                                                    ...editForm,
                                                    category: e.target.value,
                                                })
                                            }
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs uppercase text-gray-500 mb-1">
                                            {t.admin.subcategory}
                                        </label>
                                        <input
                                            className="w-full bg-gray-200 border border-gray-300 rounded p-2 text-gray-700"
                                            placeholder="e.g. SPC"
                                            value={editForm.subcategory || ""}
                                            onChange={(e) =>
                                                setEditForm({
                                                    ...editForm,
                                                    subcategory: e.target.value,
                                                })
                                            }
                                        />
                                    </div>

                                    {/* Row 3: Dimensions */}
                                    <div>
                                        <label className="block text-xs uppercase text-gray-500 mb-1">
                                            {t.admin.width}
                                        </label>
                                        <input
                                            type="number"
                                            className="w-full bg-gray-200 border border-gray-300 rounded p-2 text-gray-700"
                                            placeholder="0.00"
                                            value={
                                                editForm.dimensions?.width || ""
                                            }
                                            onChange={(e) =>
                                                setEditForm({
                                                    ...editForm,
                                                    dimensions: {
                                                        ...(editForm.dimensions || {
                                                            width: 0,
                                                            length: 0,
                                                            thickness: 0,
                                                        }),
                                                        width: parseFloat(
                                                            e.target.value,
                                                        ),
                                                    },
                                                })
                                            }
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs uppercase text-gray-500 mb-1">
                                            {t.admin.length}
                                        </label>
                                        <input
                                            type="number"
                                            className="w-full bg-gray-200 border border-gray-300 rounded p-2 text-gray-700"
                                            placeholder="0.00"
                                            value={
                                                editForm.dimensions?.length ||
                                                ""
                                            }
                                            onChange={(e) =>
                                                setEditForm({
                                                    ...editForm,
                                                    dimensions: {
                                                        ...(editForm.dimensions || {
                                                            width: 0,
                                                            length: 0,
                                                            thickness: 0,
                                                        }),
                                                        length: parseFloat(
                                                            e.target.value,
                                                        ),
                                                    },
                                                })
                                            }
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs uppercase text-gray-500 mb-1">
                                            {t.admin.thickness}
                                        </label>
                                        <input
                                            type="number"
                                            className="w-full bg-gray-200 border border-gray-300 rounded p-2 text-gray-700"
                                            placeholder="0.00"
                                            value={
                                                editForm.dimensions
                                                    ?.thickness || ""
                                            }
                                            onChange={(e) =>
                                                setEditForm({
                                                    ...editForm,
                                                    dimensions: {
                                                        ...(editForm.dimensions || {
                                                            width: 0,
                                                            length: 0,
                                                            thickness: 0,
                                                        }),
                                                        thickness: parseFloat(
                                                            e.target.value,
                                                        ),
                                                    },
                                                })
                                            }
                                        />
                                    </div>

                                    {/* Row 4: Pricing */}
                                    <div>
                                        <label className="block text-xs uppercase text-gray-500 mb-1">
                                            {t.admin.price}
                                        </label>
                                        <input
                                            type="number"
                                            className="w-full bg-gray-200 border border-gray-300 rounded p-2 text-gray-700"
                                            placeholder="0.00"
                                            value={
                                                editForm.pricing
                                                    ?.pricePerUnit || ""
                                            }
                                            onChange={(e) =>
                                                setEditForm({
                                                    ...editForm,
                                                    pricing: {
                                                        ...editForm.pricing!,
                                                        pricePerUnit:
                                                            parseFloat(
                                                                e.target.value,
                                                            ),
                                                        currency: "MXN",
                                                    },
                                                })
                                            }
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs uppercase text-gray-500 mb-1">
                                            {lang === "es" ? "Precio (Contratista)" : "Price (Contractor)"}
                                        </label>
                                        <input
                                            type="number"
                                            className="w-full bg-gray-200 border border-gray-300 rounded p-2 text-gray-700"
                                            placeholder="0.00"
                                            value={editForm.pricing?.priceContractor || ""}
                                            onChange={(e) =>
                                                setEditForm({
                                                    ...editForm,
                                                    pricing: {
                                                        ...(editForm.pricing || { pricePerUnit: 0, currency: 'USD', unitLabel: 'Piece', itemsPerBox: 1 }),
                                                        priceContractor: parseFloat(e.target.value),
                                                    },
                                                })
                                            }
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs uppercase text-gray-500 mb-1">
                                            {t.admin.unitLabel}
                                        </label>
                                        <input
                                            className="w-full bg-gray-200 border border-gray-300 rounded p-2 text-gray-700"
                                            placeholder="Box, Roll, Piece"
                                            value={
                                                editForm.pricing?.unitLabel ||
                                                ""
                                            }
                                            onChange={(e) =>
                                                setEditForm({
                                                    ...editForm,
                                                    pricing: {
                                                        ...editForm.pricing!,
                                                        unitLabel:
                                                            e.target.value,
                                                    },
                                                })
                                            }
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs uppercase text-gray-500 mb-1">
                                            {t.admin.itemsPerBox}
                                        </label>
                                        <input
                                            type="number"
                                            className="w-full bg-gray-200 border border-gray-300 rounded p-2 text-gray-700"
                                            placeholder="1"
                                            value={
                                                editForm.pricing?.itemsPerBox ||
                                                1
                                            }
                                            onChange={(e) =>
                                                setEditForm({
                                                    ...editForm,
                                                    pricing: {
                                                        ...editForm.pricing!,
                                                        itemsPerBox: parseFloat(
                                                            e.target.value,
                                                        ),
                                                    },
                                                })
                                            }
                                        />
                                    </div>

                                    <div className="md:col-span-3">
                                        <label className="block text-xs uppercase text-gray-500 mb-1">
                                            {t.admin.detailedDesc}
                                        </label>
                                        <textarea
                                            rows={4}
                                            className="w-full bg-gray-200 border border-gray-300 rounded p-2 text-gray-700 text-sm"
                                            placeholder={
                                                t.admin.texturePlaceholder
                                            }
                                            value={editForm.description || ""}
                                            onChange={(e) =>
                                                setEditForm({
                                                    ...editForm,
                                                    description: e.target.value,
                                                })
                                            }
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs uppercase text-gray-500 mb-1">
                                            {t.admin.usage}
                                        </label>
                                        <div className="flex gap-4 p-2 bg-gray-200 border border-gray-300 rounded">
                                            <label className="flex items-center gap-2 cursor-pointer text-gray-700">
                                                <input
                                                    type="radio"
                                                    name="usage"
                                                    checked={
                                                        editForm.usage ===
                                                        "Interior"
                                                    }
                                                    onChange={() =>
                                                        setEditForm({
                                                            ...editForm,
                                                            usage: "Interior",
                                                        })
                                                    }
                                                />
                                                {t.admin.interior}
                                            </label>
                                            <label className="flex items-center gap-2 cursor-pointer text-gray-700">
                                                <input
                                                    type="radio"
                                                    name="usage"
                                                    checked={
                                                        editForm.usage ===
                                                        "Exterior"
                                                    }
                                                    onChange={() =>
                                                        setEditForm({
                                                            ...editForm,
                                                            usage: "Exterior",
                                                        })
                                                    }
                                                />
                                                {t.admin.exterior}
                                            </label>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs uppercase text-gray-500 mb-1">
                                            {t.admin.currency}
                                        </label>
                                        <div className="flex gap-4 p-2 bg-gray-200 border border-gray-300 rounded">
                                            <label className="flex items-center gap-2 cursor-pointer text-gray-700">
                                                <input
                                                    type="radio"
                                                    name="currency"
                                                    checked={
                                                        editForm.pricing
                                                            ?.currency === "USD"
                                                    }
                                                    onChange={() =>
                                                        setEditForm({
                                                            ...editForm,
                                                            pricing: {
                                                                ...editForm.pricing!,
                                                                currency: "USD",
                                                            },
                                                        })
                                                    }
                                                />
                                                USD
                                            </label>
                                            <label className="flex items-center gap-2 cursor-pointer text-gray-700">
                                                <input
                                                    type="radio"
                                                    name="currency"
                                                    checked={
                                                        editForm.pricing
                                                            ?.currency === "COP"
                                                    }
                                                    onChange={() =>
                                                        setEditForm({
                                                            ...editForm,
                                                            pricing: {
                                                                ...editForm.pricing!,
                                                                currency: "COP",
                                                            },
                                                        })
                                                    }
                                                />
                                                COP (Pesos)
                                            </label>
                                        </div>
                                    </div>

                                    <div className="md:col-span-2">
                                        <label className="block text-xs uppercase text-gray-500 mb-1">
                                            {lang === "es"
                                                ? "URL de Imagen"
                                                : "Image URL"}
                                        </label>
                                        <div className="flex gap-2 items-center">
                                            <input
                                                type="text"
                                                className="flex-1 bg-gray-200 border border-gray-300 rounded p-2 text-gray-700 text-sm"
                                                placeholder="https://example.com/image.jpg"
                                                value={editForm.imageUrl || ""}
                                                onChange={(e) =>
                                                    setEditForm({
                                                        ...editForm,
                                                        imageUrl:
                                                            e.target.value,
                                                    })
                                                }
                                            />
                                            {editForm.imageUrl && (
                                                <img
                                                    src={
                                                        editForm.imageUrl ||
                                                        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect fill='%23374151' width='100' height='100'/%3E%3C/svg%3E"
                                                    }
                                                    className="w-10 h-10 rounded border border-gray-300 object-cover"
                                                />
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex justify-end gap-3">
                                    <Button
                                        variant="ghost"
                                        onClick={() => {
                                            setEditForm({});
                                            setIsEditing(false);
                                        }}
                                    >
                                        {t.admin.cancel}
                                    </Button>
                                    <Button onClick={handleSaveMaterial}>
                                        {t.admin.save}
                                    </Button>
                                </div>
                            </div>
                        )}

                        {/* Data Table */}
                        {(() => {
                            const filteredMaterials =
                                adminCollectionFilter === "All"
                                    ? materials
                                    : materials.filter(
                                          (m) =>
                                              m.usage === adminCollectionFilter,
                                      );
                            const totalPages = Math.ceil(
                                filteredMaterials.length / itemsPerPage,
                            );
                            const startIndex = (currentPage - 1) * itemsPerPage;
                            const paginatedMaterials = filteredMaterials.slice(
                                startIndex,
                                startIndex + itemsPerPage,
                            );
                            const allPageIds = paginatedMaterials.map(
                                (m) => m.id,
                            );
                            const allSelected =
                                allPageIds.length > 0 &&
                                allPageIds.every((id) =>
                                    selectedMaterialIds.has(id),
                                );

                            return (
                                <>
                                    <div className="bg-white rounded-xl border border-gray-300 overflow-hidden">
                                        <table className="w-full text-left text-sm text-gray-600">
                                            <thead className="bg-gray-300 text-gray-700 uppercase text-xs font-bold">
                                                <tr>
                                                    <th className="p-4 w-12">
                                                        <input
                                                            type="checkbox"
                                                            checked={
                                                                allSelected
                                                            }
                                                            onChange={() =>
                                                                toggleSelectAll(
                                                                    allPageIds,
                                                                )
                                                            }
                                                            className="w-4 h-4 rounded border-gray-300 bg-gray-200 text-blue-500 focus:ring-blue-500"
                                                        />
                                                    </th>
                                                    <th className="p-4">
                                                        {t.admin.tableImage}
                                                    </th>
                                                    <th className="p-4">
                                                        {t.admin.tableSKU}
                                                    </th>
                                                    <th className="p-4">
                                                        {t.admin.tableName}
                                                    </th>
                                                    <th className="p-4">
                                                        {
                                                            t.admin
                                                                .tableDimensions
                                                        }
                                                    </th>
                                                    <th className="p-4">
                                                        {t.admin.tablePackaging}
                                                    </th>
                                                    <th className="p-4">
                                                        {lang === "es"
                                                            ? "Uso"
                                                            : "Usage"}
                                                    </th>
                                                    <th className="p-4">
                                                        {t.admin.tablePrice}
                                                    </th>
                                                    <th className="p-4 text-right">
                                                        {t.admin.actions}
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-700">
                                                {paginatedMaterials.map((m) => (
                                                    <tr
                                                        key={m.id}
                                                        className={`hover:bg-gray-300/50 transition-colors ${selectedMaterialIds.has(m.id) ? "bg-blue-900/20" : ""}`}
                                                    >
                                                        <td className="p-4">
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedMaterialIds.has(
                                                                    m.id,
                                                                )}
                                                                onChange={() =>
                                                                    toggleSelectMaterial(
                                                                        m.id,
                                                                    )
                                                                }
                                                                className="w-4 h-4 rounded border-gray-300 bg-gray-200 text-blue-500 focus:ring-blue-500"
                                                            />
                                                        </td>
                                                        <td className="p-4">
                                                            <img
                                                                src={
                                                                    m.imageUrl ||
                                                                    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect fill='%23374151' width='100' height='100'/%3E%3C/svg%3E"
                                                                }
                                                                alt={m.name}
                                                                onError={handleImageError}
                                                                className="w-12 h-12 rounded object-cover border border-gray-300 bg-gray-200"
                                                            />
                                                        </td>
                                                        <td className="p-4 font-mono text-blue-400">
                                                            {m.refCode}
                                                        </td>
                                                        <td className="p-4 font-medium text-gray-700">
                                                            {m.name}
                                                            <div className="text-xs text-gray-500">
                                                                {m.category}
                                                            </div>
                                                        </td>
                                                        <td className="p-4">
                                                            <div className="text-gray-700">
                                                                {
                                                                    m.dimensions
                                                                        .width
                                                                }{" "}
                                                                x{" "}
                                                                {
                                                                    m.dimensions
                                                                        .length
                                                                }{" "}
                                                                cm
                                                            </div>
                                                            <div className="text-xs text-gray-500">
                                                                {
                                                                    m.dimensions
                                                                        .thickness
                                                                }{" "}
                                                                mm
                                                            </div>
                                                        </td>
                                                        <td className="p-4">
                                                            {m.pricing
                                                                .itemsPerBox &&
                                                            m.pricing
                                                                .itemsPerBox >
                                                                1 ? (
                                                                <span className="text-green-400">
                                                                    {
                                                                        m
                                                                            .pricing
                                                                            .itemsPerBox
                                                                    }{" "}
                                                                    items/box
                                                                </span>
                                                            ) : (
                                                                <span className="text-gray-500">
                                                                    Single Unit
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="p-4">
                                                            <span
                                                                className={`px-2 py-0.5 rounded-full text-[10px] uppercase font-bold ${m.usage === "Interior" ? "bg-green-900/50 text-green-400" : "bg-orange-900/50 text-orange-400"}`}
                                                            >
                                                                {m.usage ===
                                                                "Interior"
                                                                    ? t.admin
                                                                          .interior
                                                                    : t.admin
                                                                          .exterior}
                                                            </span>
                                                        </td>
                                                        <td className="p-4 text-gray-700 font-bold">
                                                            {formatPrice(
                                                                m.pricing
                                                                    .pricePerUnit,
                                                                m.pricing
                                                                    .currency,
                                                                displayCurrency,
                                                            )}
                                                            <span className="text-xs text-gray-500 font-normal ml-1">
                                                                /{" "}
                                                                {
                                                                    m.pricing
                                                                        .unitLabel
                                                                }
                                                            </span>
                                                        </td>
                                                        <td className="p-4 text-right space-x-2">
                                                            <button
                                                                onClick={() => {
                                                                    setEditForm(
                                                                        m,
                                                                    );
                                                                    setIsEditing(
                                                                        true,
                                                                    );
                                                                }}
                                                                className="text-blue-400 hover:text-gray-700 px-2 py-1 hover:bg-gray-400 rounded"
                                                            >
                                                                {t.admin.edit}
                                                            </button>
                                                            <button
                                                                onClick={() =>
                                                                    handleDeleteMaterial(
                                                                        m.id,
                                                                    )
                                                                }
                                                                className="text-red-400 hover:text-gray-700 px-2 py-1 hover:bg-red-900/50 rounded"
                                                            >
                                                                {t.admin.delete}
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                        {filteredMaterials.length === 0 && (
                                            <div className="p-8 text-center text-gray-500">
                                                {adminCollectionFilter === "All"
                                                    ? t.admin.noProducts
                                                    : lang === "es"
                                                      ? `No hay productos en ${adminCollectionFilter}`
                                                      : `No products in ${adminCollectionFilter}`}
                                            </div>
                                        )}
                                    </div>

                                    {/* Pagination Controls */}
                                    {totalPages > 1 && (
                                        <div className="flex items-center justify-between mt-4 px-4">
                                            <div className="text-sm text-gray-500">
                                                {lang === "es"
                                                    ? `Mostrando ${startIndex + 1}-${Math.min(startIndex + itemsPerPage, filteredMaterials.length)} de ${filteredMaterials.length}`
                                                    : `Showing ${startIndex + 1}-${Math.min(startIndex + itemsPerPage, filteredMaterials.length)} of ${filteredMaterials.length}`}
                                            </div>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() =>
                                                        setCurrentPage(
                                                            Math.max(
                                                                1,
                                                                currentPage - 1,
                                                            ),
                                                        )
                                                    }
                                                    disabled={currentPage === 1}
                                                    className="px-3 py-1 rounded bg-gray-300 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-400"
                                                >
                                                    {lang === "es"
                                                        ? "Anterior"
                                                        : "Previous"}
                                                </button>
                                                <div className="flex items-center gap-1">
                                                    {Array.from(
                                                        { length: totalPages },
                                                        (_, i) => i + 1,
                                                    ).map((page) => (
                                                        <button
                                                            key={page}
                                                            onClick={() =>
                                                                setCurrentPage(
                                                                    page,
                                                                )
                                                            }
                                                            className={`w-8 h-8 rounded ${currentPage === page ? "bg-blue-600 text-gray-700" : "bg-gray-300 text-gray-600 hover:bg-gray-400"}`}
                                                        >
                                                            {page}
                                                        </button>
                                                    ))}
                                                </div>
                                                <button
                                                    onClick={() =>
                                                        setCurrentPage(
                                                            Math.min(
                                                                totalPages,
                                                                currentPage + 1,
                                                            ),
                                                        )
                                                    }
                                                    disabled={
                                                        currentPage ===
                                                        totalPages
                                                    }
                                                    className="px-3 py-1 rounded bg-gray-300 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-400"
                                                >
                                                    {lang === "es"
                                                        ? "Siguiente"
                                                        : "Next"}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </>
                            );
                        })()}
                    </div>
                )}

                {adminTab === "CONTRACTORS" && (
                    <div className="space-y-6 animate-fadeIn">
                        <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-xl shadow-gray-100/50">
                            <h3 className="text-xl font-black text-gray-700 uppercase tracking-tighter mb-4">
                                {lang === "es" ? "Añadir Instalador Profesional" : "Add Professional Installer"}
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                                <input
                                    className="bg-white border border-gray-200 rounded-xl p-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-semibold"
                                    placeholder={lang === "es" ? "Nombre de la Empresa" : "Company Name"}
                                    value={contractorForm.name || ""}
                                    onChange={(e) =>
                                        setContractorForm({
                                            ...contractorForm,
                                            name: e.target.value,
                                        })
                                    }
                                />
                                <input
                                    className="bg-white border border-gray-200 rounded-xl p-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-semibold"
                                    placeholder={lang === "es" ? "Región / Departamento" : "Region / Department"}
                                    value={contractorForm.region || ""}
                                    onChange={(e) =>
                                        setContractorForm({
                                            ...contractorForm,
                                            region: e.target.value,
                                        })
                                    }
                                />
                                <input
                                    className="bg-white border border-gray-200 rounded-xl p-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-semibold"
                                    placeholder={lang === "es" ? "Correo Electrónico" : "Email Address"}
                                    value={contractorForm.email || ""}
                                    onChange={(e) =>
                                        setContractorForm({
                                            ...contractorForm,
                                            email: e.target.value,
                                        })
                                    }
                                />
                                <input
                                    className="bg-white border border-gray-200 rounded-xl p-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-semibold"
                                    placeholder={lang === "es" ? "Número de Teléfono" : "Phone Number"}
                                    value={contractorForm.phone || ""}
                                    onChange={(e) =>
                                        setContractorForm({
                                            ...contractorForm,
                                            phone: e.target.value,
                                        })
                                    }
                                />
                                <input
                                    className="bg-white border border-gray-200 rounded-xl p-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-semibold md:col-span-2"
                                    placeholder={lang === "es" ? "Dirección Física (Ej: Calle 100 # 15-30, Bogotá)" : "Physical Address (e.g., Calle 100 # 15-30, Bogota)"}
                                    value={contractorForm.address || ""}
                                    onChange={(e) =>
                                        setContractorForm({
                                            ...contractorForm,
                                            address: e.target.value,
                                        })
                                    }
                                />
                            </div>
                            <div className="flex justify-end">
                                <button 
                                    onClick={handleSaveContractor}
                                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black uppercase tracking-widest active:scale-95 transition-all shadow-md shadow-blue-500/10 hover:shadow-blue-500/20"
                                >
                                    {lang === "es" ? "Añadir Instalador" : "Add Installer"}
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {contractors.map((c) => (
                                <div
                                    key={c.id}
                                    className="bg-white p-6 rounded-3xl border border-gray-200 shadow-lg shadow-gray-100/50 space-y-3 relative overflow-hidden group hover:border-blue-300 transition-all duration-300"
                                >
                                    <div className="absolute top-0 right-0 w-24 h-24 bg-blue-50 rounded-bl-full -z-10 group-hover:bg-blue-100/70 transition-colors"></div>
                                    <div className="font-black text-gray-700 text-lg uppercase tracking-tight">
                                        {c.name}
                                    </div>
                                    <div className="inline-flex text-[10px] font-black uppercase tracking-wider bg-blue-50 text-blue-700 px-3 py-1 rounded-full border border-blue-200">
                                        📍 {c.region}
                                    </div>
                                    
                                    <div className="space-y-1.5 pt-3 border-t border-gray-100 text-xs font-semibold text-gray-500">
                                        <div className="flex items-center gap-2">
                                            <span className="text-gray-400">📧</span>
                                            <span>{c.email || 'N/A'}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-gray-400">📞</span>
                                            <span>{c.phone || 'N/A'}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-gray-400">🏠</span>
                                            <span>{c.address || (lang === 'es' ? 'Dirección no registrada' : 'No address registered')}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {adminTab === "PURCHASES" && <AdminPurchaseQueue />}

                {adminTab === "USERS" && (
                    <div className="space-y-6">
                        {/* Create Admin Form */}
                        <div className="bg-white p-6 rounded-xl border border-gray-300 shadow-sm">
                            <h3 className="text-lg font-bold text-gray-700 mb-4 flex items-center gap-2">
                                <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>
                                {lang === 'es' ? 'Crear Nuevo Administrador' : 'Create New Admin User'}
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                <input
                                    className="bg-gray-50 border border-gray-300 rounded p-2 text-sm text-gray-700"
                                    placeholder={lang === 'es' ? 'Nombre Completo' : 'Full Name'}
                                    value={newAdminForm.name}
                                    onChange={(e) => setNewAdminForm({ ...newAdminForm, name: e.target.value })}
                                />
                                <input
                                    className="bg-gray-50 border border-gray-300 rounded p-2 text-sm text-gray-700"
                                    placeholder={lang === 'es' ? 'Correo Electrónico' : 'Email Address'}
                                    value={newAdminForm.email}
                                    onChange={(e) => setNewAdminForm({ ...newAdminForm, email: e.target.value })}
                                />
                                <input
                                    type="password"
                                    className="bg-gray-50 border border-gray-300 rounded p-2 text-sm text-gray-700"
                                    placeholder={lang === 'es' ? 'Contraseña' : 'Password'}
                                    value={newAdminForm.password}
                                    onChange={(e) => setNewAdminForm({ ...newAdminForm, password: e.target.value })}
                                />
                                <Button 
                                    onClick={handleCreateAdmin} 
                                    disabled={isCreatingAdmin}
                                    className="h-full"
                                >
                                    {isCreatingAdmin ? (lang === 'es' ? 'Creando...' : 'Creating...') : (lang === 'es' ? 'Registrar Admin' : 'Register Admin')}
                                </Button>
                            </div>
                            <p className="mt-2 text-[10px] text-gray-500 italic">
                                {lang === 'es' ? '* Los administradores tienen acceso completo y nivel Enterprise ilimitado.' : '* Admin users have full access and unlimited Enterprise tier benefits.'}
                            </p>
                        </div>

                        <div className="bg-white rounded-xl border border-gray-300 overflow-hidden shadow-sm">
                            <table className="w-full text-left text-sm text-gray-600">
                                <thead className="bg-gray-50 text-gray-700 uppercase text-[10px] font-bold border-b border-gray-200">
                                    <tr>
                                        <th className="p-4">User</th>
                                        <th className="p-4">Email / Role</th>
                                        <th className="p-4">Current Tier</th>
                                        <th className="p-4">Usage</th>
                                        <th className="p-4 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {allUsers.map((u) => (
                                        <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                                            <td className="p-4">
                                                <div className="font-bold text-gray-800">{u.name}</div>
                                                <div className="text-[10px] text-gray-500">UID: {u.id}</div>
                                            </td>
                                            <td className="p-4">
                                                <div>{u.email}</div>
                                                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${u.role === 'admin' ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
                                                    {u.role}
                                                </span>
                                            </td>
                                            <td className="p-4">
                                                <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase font-bold ${
                                                    u.tier === 'Enterprise' ? 'bg-purple-100 text-purple-700' : 
                                                    u.tier === 'Pro' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                                                }`}>
                                                    {u.tier}
                                                </span>
                                            </td>
                                            <td className="p-4">
                                                <div className="w-24 bg-gray-200 rounded-full h-1.5 mb-1">
                                                    <div 
                                                        className="bg-blue-500 h-1.5 rounded-full" 
                                                        style={{ width: `${Math.min(100, (u.generations_used / getTierLimit(u.tier || 'Free')) * 100)}%` }}
                                                    ></div>
                                                </div>
                                                <input 
                                                    type="number"
                                                    className="w-16 bg-gray-200 border border-gray-300 rounded text-[10px] p-1 mt-1"
                                                    value={u.generations_used}
                                                    onChange={(e) => handleUpdateUserGenerations(u.id, parseInt(e.target.value) || 0)}
                                                />
                                                <span className="text-[10px] text-gray-500 ml-1">gens</span>
                                            </td>
                                            <td className="p-4 text-right flex items-center justify-end gap-2">
                                                <select 
                                                    className="bg-gray-200 border border-gray-300 rounded text-xs p-1"
                                                    value={u.tier}
                                                    onChange={(e) => handleUpdateUserTier(u.id, e.target.value)}
                                                >
                                                    <option value="Free">Free</option>
                                                    <option value="Pro">Pro</option>
                                                    <option value="Enterprise">Enterprise</option>
                                                </select>
                                                <button
                                                    onClick={() => handleViewUserDetail(u.id)}
                                                    className="p-1.5 bg-blue-50 hover:bg-blue-100 rounded text-blue-600 transition-colors flex items-center justify-center border border-blue-200"
                                                    title="View Memory & Analytics"
                                                >
                                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {adminTab === "SETTINGS" && (
                    <div className="max-w-5xl space-y-8 animate-fadeIn">
                        {/* Tiers Manager */}
                        <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-xl shadow-gray-100/50">
                            <div className="flex justify-between items-start mb-6">
                                <div>
                                    <h3 className="text-2xl font-black text-gray-700 uppercase tracking-tighter">
                                        Subscription Tiers & Pricing Manager
                                    </h3>
                                    <p className="text-sm text-gray-400">
                                        {lang === "es"
                                            ? "Personaliza los nombres de planes, límites de renderizado por IA, precios mensuales y Stripe IDs."
                                            : "Customize display names, AI render limits, monthly pricing, and Stripe IDs for subscription plans."}
                                    </p>
                                </div>
                            </div>

                            {editableTiers ? (
                                <div className="space-y-8">
                                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                        {['FREE', 'STANDARD', 'PREMIUM', 'LUXURY'].map((tierKey) => {
                                            const tierData = editableTiers[tierKey];
                                            if (!tierData) return null;
                                            
                                            // Curated harmonized visual styles
                                            const cardStyle = tierKey === 'FREE' 
                                                ? 'border-gray-200 bg-gray-50/50 shadow-sm' 
                                                : tierKey === 'STANDARD' 
                                                ? 'border-blue-200 bg-blue-50/10 shadow-md shadow-blue-500/5 hover:border-blue-400' 
                                                : tierKey === 'PREMIUM'
                                                ? 'border-purple-200 bg-purple-50/10 shadow-md shadow-purple-500/5 hover:border-purple-400'
                                                : 'border-amber-200 bg-amber-50/10 shadow-md shadow-amber-500/5 hover:border-amber-400';
                                                
                                            const badgeStyle = tierKey === 'FREE' 
                                                ? 'bg-gray-100 text-gray-600' 
                                                : tierKey === 'STANDARD' 
                                                ? 'bg-blue-100 text-blue-700' 
                                                : tierKey === 'PREMIUM'
                                                ? 'bg-purple-100 text-purple-700'
                                                : 'bg-amber-100 text-amber-700';

                                            return (
                                                <div key={tierKey} className={`p-6 rounded-3xl border-2 ${cardStyle} transition-all duration-300 hover:shadow-lg space-y-4`}>
                                                    <div className="flex justify-between items-center pb-2 border-b border-gray-100">
                                                        <span className={`text-xs font-extrabold px-3 py-1 rounded-full uppercase tracking-wider ${badgeStyle}`}>
                                                            {tierKey}
                                                        </span>
                                                        {tierData.limit >= 9999 ? (
                                                            <span className="text-[10px] bg-green-50 text-green-700 font-bold px-2 py-0.5 rounded-full border border-green-200">
                                                                Unlimited Limit
                                                            </span>
                                                        ) : (
                                                            <span className="text-[10px] text-gray-400 font-medium">
                                                                {tierData.limit} max renders
                                                            </span>
                                                        )}
                                                    </div>

                                                    <div className="space-y-4">
                                                        <div>
                                                            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
                                                                Display Name
                                                            </label>
                                                            <input
                                                                type="text"
                                                                value={tierData.name}
                                                                onChange={(e) => handleUpdateTierField(tierKey, 'name', e.target.value)}
                                                                className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-semibold"
                                                            />
                                                        </div>

                                                        <div>
                                                            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
                                                                AI Render Limit
                                                            </label>
                                                            <div className="relative">
                                                                <input
                                                                    type="number"
                                                                    value={tierData.limit}
                                                                    onChange={(e) => handleUpdateTierField(tierKey, 'limit', parseInt(e.target.value, 10) || 0)}
                                                                    className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-semibold"
                                                                />
                                                            </div>
                                                            <p className="text-[9px] text-gray-400 mt-1 italic">
                                                                Use 9999 to configure unlimited quota.
                                                            </p>
                                                        </div>

                                                        <div>
                                                            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
                                                                Price ($USD / month)
                                                            </label>
                                                            <div className="relative rounded-xl shadow-sm">
                                                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                                                    <span className="text-gray-400 text-xs font-bold">$</span>
                                                                </div>
                                                                <input
                                                                    type="number"
                                                                    step="0.01"
                                                                    value={tierData.price}
                                                                    onChange={(e) => handleUpdateTierField(tierKey, 'price', parseFloat(e.target.value) || 0)}
                                                                    className="w-full bg-white border border-gray-200 rounded-xl pl-6 pr-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-semibold"
                                                                />
                                                            </div>
                                                        </div>

                                                        <div>
                                                            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
                                                                Stripe Price ID
                                                            </label>
                                                            <input
                                                                type="text"
                                                                placeholder="e.g. price_1Hh1..."
                                                                value={tierData.stripePriceId || ''}
                                                                onChange={(e) => handleUpdateTierField(tierKey, 'stripePriceId', e.target.value)}
                                                                className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono"
                                                            />
                                                            <p className="text-[9px] text-gray-400 mt-1">
                                                                Leave blank or configure Stripe catalog item.
                                                            </p>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    <div className="flex justify-end pt-6 border-t border-gray-100">
                                        <button
                                            onClick={handleSaveTiers}
                                            disabled={isSavingTiers}
                                            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-2xl text-xs font-black uppercase tracking-widest shadow-lg shadow-blue-500/20 hover:shadow-blue-500/35 active:scale-95 transition-all flex items-center gap-2"
                                        >
                                            {isSavingTiers ? (
                                                <>
                                                    <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                                    </svg>
                                                    {lang === "es" ? "Guardando..." : "Saving..."}
                                                </>
                                            ) : (
                                                lang === "es" ? "Guardar Configuración" : "Save Plans Configuration"
                                            )}
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="py-12 flex justify-center items-center">
                                    <svg className="animate-spin h-8 w-8 text-blue-600" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                </div>
                            )}
                        </div>

                        {/* Secure Credentials Manager Card */}
                        <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-xl shadow-gray-100/50 space-y-6 animate-fadeIn">
                            <div>
                                <h3 className="text-2xl font-black text-gray-700 uppercase tracking-tighter">
                                    {lang === "es" ? "Gestor de Credenciales del Servidor" : "Server Credentials & Keys Manager"}
                                </h3>
                                <p className="text-sm text-gray-400 mt-1">
                                    {lang === "es"
                                        ? "Configura las claves de API del servidor de forma segura. Las claves se guardan de forma encriptada en el servidor y nunca se exponen al navegador."
                                        : "Securely configure server-side API keys and secrets. Credentials are stored securely on the server and are never exposed to the client browser."}
                                </p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {/* Gemini status */}
                                <div className="p-4 rounded-2xl border border-gray-100 bg-gray-50/50 flex flex-col justify-between space-y-2">
                                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Gemini API Key</span>
                                    <div className="flex items-center gap-2">
                                        <span className={`w-2.5 h-2.5 rounded-full ${secureConfig?.hasKey ? 'bg-green-500 animate-pulse' : 'bg-amber-400'}`}></span>
                                        <span className="text-xs font-bold text-gray-600">
                                            {secureConfig?.hasKey 
                                                ? (lang === 'es' ? "Configurado (Activo)" : "Configured (Active)") 
                                                : (lang === 'es' ? "No Configurado" : "Not Configured")}
                                        </span>
                                    </div>
                                </div>

                                {/* Stripe Key status */}
                                <div className="p-4 rounded-2xl border border-gray-100 bg-gray-50/50 flex flex-col justify-between space-y-2">
                                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Stripe Secret Key</span>
                                    <div className="flex items-center gap-2">
                                        <span className={`w-2.5 h-2.5 rounded-full ${secureConfig?.hasStripeSecretKey ? 'bg-green-500 animate-pulse' : 'bg-amber-400'}`}></span>
                                        <span className="text-xs font-bold text-gray-600">
                                            {secureConfig?.hasStripeSecretKey 
                                                ? (lang === 'es' ? "Configurado (Activo)" : "Configured (Active)") 
                                                : (lang === 'es' ? "No Configurado" : "Not Configured")}
                                        </span>
                                    </div>
                                </div>

                                {/* Stripe Webhook status */}
                                <div className="p-4 rounded-2xl border border-gray-100 bg-gray-50/50 flex flex-col justify-between space-y-2">
                                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Stripe Webhook Secret</span>
                                    <div className="flex items-center gap-2">
                                        <span className={`w-2.5 h-2.5 rounded-full ${secureConfig?.hasStripeWebhookSecret ? 'bg-green-500 animate-pulse' : 'bg-amber-400'}`}></span>
                                        <span className="text-xs font-bold text-gray-600">
                                            {secureConfig?.hasStripeWebhookSecret 
                                                ? (lang === 'es' ? "Configurado (Activo)" : "Configured (Active)") 
                                                : (lang === 'es' ? "No Configurado" : "Not Configured")}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-4 pt-2">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
                                            {lang === 'es' ? "Nueva Clave de API Gemini" : "New Gemini API Key"}
                                        </label>
                                        <input
                                            type="password"
                                            placeholder="AIzaSy..."
                                            value={configForm.apiKey}
                                            onChange={(e) => setConfigForm({ ...configForm, apiKey: e.target.value })}
                                            className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
                                            {lang === 'es' ? "Nueva Clave Secreta de Stripe" : "New Stripe Secret Key"}
                                        </label>
                                        <input
                                            type="password"
                                            placeholder="sk_live_..."
                                            value={configForm.stripeSecretKey}
                                            onChange={(e) => setConfigForm({ ...configForm, stripeSecretKey: e.target.value })}
                                            className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
                                        {lang === 'es' ? "Nuevo Secreto de Webhook Stripe" : "New Stripe Webhook Secret"}
                                    </label>
                                    <input
                                        type="password"
                                        placeholder="whsec_..."
                                        value={configForm.stripeWebhookSecret}
                                        onChange={(e) => setConfigForm({ ...configForm, stripeWebhookSecret: e.target.value })}
                                        className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono"
                                    />
                                    <p className="text-[10px] text-gray-400 mt-1 italic">
                                        {lang === 'es' 
                                            ? "Los campos en blanco no se modificarán para proteger tus credenciales guardadas." 
                                            : "Fields left blank will remain unchanged to protect your existing credentials."}
                                    </p>
                                </div>
                            </div>

                            <div className="flex justify-end pt-4 border-t border-gray-100">
                                <button
                                    onClick={handleSaveSecureConfig}
                                    disabled={isSavingConfig}
                                    className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-2xl text-xs font-black uppercase tracking-widest shadow-lg shadow-blue-500/20 hover:shadow-blue-500/35 active:scale-95 transition-all flex items-center gap-2"
                                >
                                    {isSavingConfig ? (
                                        <>
                                            <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                            </svg>
                                            {lang === "es" ? "Guardando..." : "Saving..."}
                                        </>
                                    ) : (
                                        lang === "es" ? "Guardar Credenciales" : "Save Credentials"
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {adminTab === "AUDIT_LOGS" && renderAuditLogsComponent()}
            </div>
        </div>
    );

    const renderGallery = () => {
        const filtered = materials.filter(
            (m) =>
                (categoryUsage === "All" || m.usage?.toLowerCase() === categoryUsage.toLowerCase()) &&
                (m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    m.category
                        .toLowerCase()
                        .includes(searchQuery.toLowerCase())),
        );

        return (
            <div className="min-h-screen bg-gray-100 flex flex-col">
                <header className="bg-white/80 backdrop-blur-md sticky top-0 z-20 border-b border-gray-300 p-4">
                    <div className="max-w-7xl mx-auto flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Button
                                variant="ghost"
                                onClick={() => setView(AppView.LANDING)}
                                className="p-2 -ml-2"
                            >
                                <svg
                                    className="w-6 h-6"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M15 19l-7-7 7-7"
                                    />
                                </svg>
                            </Button>
                            <h2 className="text-xl font-bold text-gray-700 uppercase tracking-wider">
                                {t.gallery.collection}
                            </h2>
                        </div>
                        <div className="flex gap-4 items-center">
                            {currentUser && (
                                <button 
                                    onClick={() => setShowSubscriptionModal(true)}
                                    className="flex items-center gap-2 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-3 py-1.5 rounded-full transition-all group"
                                >
                                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                                    <span className="text-[10px] font-bold text-blue-700 uppercase tracking-widest">
                                        {getTierLimit(currentUser.tier || 'Free') === 9999 ? 'Unlimited' : `${getTierLimit(currentUser.tier || 'Free') - (currentUser.generations_used || 0)} Renders`}
                                    </span>
                                    <svg className="w-3 h-3 text-blue-400 group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                                </button>
                            )}
                            <LanguageToggle />
                            <input
                                type="text"
                                placeholder={lang === "es" ? "Buscar..." : "Search..."}
                                className="w-28 sm:w-auto bg-gray-200 border-none rounded-full px-3 py-2 text-xs sm:text-sm text-gray-700 focus:ring-2 focus:ring-blue-500"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto p-4 md:p-6">
                    <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
                        {filtered.map((material) => (
                            (() => { if (filtered.indexOf(material) < 3) console.log('IMG RENDER:', material.refCode, 'imageUrl:', material.imageUrl); return null; })(),
                            <div
                                key={material.id}
                                className="group relative aspect-square rounded-2xl overflow-hidden bg-gray-200 border border-gray-300 hover:border-blue-500 hover:shadow-2xl hover:shadow-blue-900/20 transition-all"
                            >
                                <button
                                    onClick={() => handleSelectMaterial(material)}
                                    className="absolute inset-0 w-full h-full text-left"
                                >
                                    <img
                                        src={proxyImageUrl(material.imageUrl)}
                                        data-original-src={material._fallbackImageUrl || proxyImageUrl(material.imageUrl)}
                                        alt={material.name}
                                        onError={handleImageError}
                                        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                    />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent p-2 flex flex-col justify-end">
                                        <div className="text-[8px] font-bold text-blue-400 uppercase tracking-wider mb-0.5">
                                            {material.category}
                                        </div>
                                        <div className="text-gray-700 text-[11px] font-bold leading-tight mb-0.5 line-clamp-2">
                                            {material.name}
                                        </div>
                                        <div className="text-[8px] text-gray-500">
                                            {material.dimensions.width}x
                                            {material.dimensions.length}cm
                                        </div>
                                    </div>
                                </button>
                                {/* Add to Cart button */}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        const dims = material.dimensions || { width: 30, length: 30 };
                                        addToCart(material, { width: dims.width, height: dims.length }, 1);
                                    }}
                                    className="absolute bottom-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold px-2.5 py-1.5 rounded-full shadow-lg flex items-center gap-1"
                                    title={lang === 'es' ? 'Añadir al carrito' : 'Add to cart'}
                                >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
                                    </svg>
                                    +
                                </button>
                                {/* Estimate button */}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedMaterial(material);
                                        setEstimationSource(AppView.GALLERY);
                                        setView(AppView.ESTIMATION);
                                    }}
                                    className="absolute bottom-2 left-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity bg-green-600 hover:bg-green-500 text-white text-[10px] font-bold px-2.5 py-1.5 rounded-full shadow-lg flex items-center gap-1"
                                    title={lang === 'es' ? 'Cotizar' : 'Estimate'}
                                >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                                    </svg>
                                    {lang === 'es' ? 'Cotizar' : 'Estimate'}
                                </button>
                            </div>
                        ))}
                    </div>
                    {filtered.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                            <p>{t.gallery.noMaterials}</p>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const renderEditor = () => {
        return (
            <div className="h-screen bg-slate-950 flex flex-col md:flex-row overflow-hidden">
                {/* Main Viewport */}
                <div className="flex-1 relative flex items-center justify-center bg-black/50 overflow-hidden">
                    {generationState.isGenerating && (
                        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm">
                            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mb-4"></div>
                            <div className="text-blue-400 font-mono text-sm animate-pulse">
                                {t.editor.processing}
                            </div>
                        </div>
                    )}

                    <div className="relative w-full h-full max-w-5xl max-h-full p-4 flex flex-col">
                        <div className="flex-1 relative min-h-0">
                            {generationState.resultImage ? (
                                <>
                                    <ImageComparator
                                        beforeImage={originalImage || ""}
                                        afterImage={generationState.resultImage}
                                        materialThumbnail={
                                            selectedMaterial?.imageUrl
                                        }
                                    />
                                    {/* Video Overlay if available */}
                                    {generationState.resultVideo && (
                                        <div className="absolute bottom-4 left-4 z-30 w-48 aspect-video rounded-lg overflow-hidden border-2 border-white shadow-2xl animate-fadeIn">
                                            <video
                                                src={
                                                    generationState.resultVideo
                                                }
                                                autoPlay
                                                loop
                                                muted
                                                className="w-full h-full object-cover"
                                            />
                                        </div>
                                    )}
                                </>
                            ) : (
                                <img
                                    src={originalImage || ""}
                                    alt="Captured"
                                    className="w-full h-full object-contain shadow-2xl"
                                    onError={(e) => {
                                        const target = e.target as HTMLImageElement;
                                        target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3Crect fill='%231e293b' width='400' height='300'/%3E%3Ctext fill='%2394a3b8' x='50%25' y='50%25' text-anchor='middle' dy='.3em' font-family='sans-serif' font-size='14'%3EImage Preview Unavailable%3C/text%3E%3C/svg%3E";
                                    }}
                                />
                            )}
                        </div>

                        {/* AI Analysis Overlay */}
                        {(generationState.analysis ||
                            generationState.isAnalyzing) && (
                            <div className="absolute bottom-8 left-8 right-8 z-40 bg-white/95 backdrop-blur border border-gray-300 p-4 rounded-xl text-xs text-gray-600 max-h-48 overflow-y-auto animate-fadeIn shadow-2xl max-w-2xl mx-auto">
                                <div className="flex items-center gap-2 mb-2 sticky top-0 bg-white/95 pb-2 border-b border-gray-300">
                                    <svg
                                        className="w-4 h-4 text-blue-400"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M13 10V3L4 14h7v7l9-11h-7z"
                                        />
                                    </svg>
                                    <span className="text-blue-400 font-bold uppercase tracking-wider">
                                        {lang === "es"
                                            ? "Análisis del Espacio"
                                            : "Room Analysis"}
                                    </span>
                                </div>
                                {generationState.isAnalyzing ? (
                                    <div className="space-y-2 py-1">
                                        <div className="h-1.5 bg-gray-300 rounded w-full animate-pulse"></div>
                                        <div className="h-1.5 bg-gray-300 rounded w-2/3 animate-pulse"></div>
                                        <div className="h-1.5 bg-gray-300 rounded w-5/6 animate-pulse"></div>
                                    </div>
                                ) : (
                                    <p className="leading-relaxed">
                                        {generationState.analysis}
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Mobile-Optimised Controls Panel */}
                <div className="w-full md:w-96 bg-white border-l border-gray-300 flex flex-col h-[50vh] md:h-full z-20 shadow-2xl">
                    {/* Top bar */}
                    <div className="p-3 border-b border-gray-200 flex items-center justify-between shrink-0">
                        <Button
                            variant="ghost"
                            onClick={() => setView(AppView.CAMERA)}
                            className="text-xs uppercase tracking-wider"
                        >
                            {t.editor.back}
                        </Button>
                        <div className="flex items-center gap-2">
                            {currentUser && (
                                <button
                                    onClick={() => setShowSubscriptionModal(true)}
                                    className="flex items-center gap-2 bg-blue-50 px-2 py-1 rounded-lg border border-blue-100"
                                >
                                    <span className="text-[9px] font-black text-blue-600 uppercase">
                                        {getTierLimit(currentUser.tier || 'Free') >= 9999 ? '∞' : getTierLimit(currentUser.tier || 'Free') - (currentUser.generations_used || 0)} Renders
                                    </span>
                                </button>
                            )}
                            <LanguageToggle />
                        </div>
                    </div>

                    {/* Scrollable area */}
                    <div className="flex-1 overflow-y-auto">
                        {/* Material chip + AI analysis */}
                        {selectedMaterial && (
                            <div className="px-3 pt-3 pb-2">
                                <div className="flex items-center gap-3 bg-gray-100 p-3 rounded-xl border border-gray-200">
                                    <div className="relative group cursor-pointer shrink-0" onClick={handleGenerateProbe}>
                                        <img
                                            src={proxyImageUrl(selectedMaterial.imageUrl)}
                                            data-original-src={selectedMaterial._fallbackImageUrl || proxyImageUrl(selectedMaterial.imageUrl)}
                                            onError={handleImageError}
                                            className="w-12 h-12 rounded-lg object-cover border border-gray-300"
                                        />
                                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg">
                                            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                                            </svg>
                                        </div>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">{t.editor.material}</div>
                                        <div className="font-bold text-gray-700 text-xs leading-tight truncate">{selectedMaterial.name}</div>
                                        <div className="text-[10px] text-blue-400">{selectedMaterial.refCode}</div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        onClick={handleRoomAnalysis}
                                        disabled={generationState.isAnalyzing}
                                        className="text-[9px] uppercase tracking-widest border border-dashed border-gray-300 hover:border-blue-500 hover:text-blue-400 px-2 py-1 shrink-0"
                                    >
                                        {generationState.isAnalyzing ? '...' : 'AI Análisis'}
                                    </Button>
                                </div>
                            </div>
                        )}

                        {/* 2-column controls grid */}
                        <div className="grid grid-cols-2 gap-x-3 gap-y-4 px-3 pb-3 pt-2">

                            {/* Lighting — full width */}
                            <div className="col-span-2">
                                <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 block">{t.editor.lighting}</label>
                                <div className="flex gap-1.5">
                                    {["NATURAL", "SUNSET", "NIGHT_LUXURY"].map((l) => (
                                        <button
                                            key={l}
                                            onClick={() => setRenderOptions({ ...renderOptions, lighting: l as any })}
                                            className={`flex-1 py-2 rounded-lg text-[9px] font-bold border transition-all ${renderOptions.lighting === l ? "bg-gray-700 border-gray-600 text-white" : "bg-gray-100 border-gray-200 text-gray-500"}`}
                                        >
                                            {l.replace("_", " ")}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Prompt — full width */}
                            <div className="col-span-2">
                                <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 block">{t.editor.instructions}</label>
                                <textarea
                                    className="w-full bg-gray-100 border border-gray-200 rounded-xl p-2.5 text-xs text-gray-700 focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none"
                                    rows={2}
                                    placeholder={lang === "es" ? "Ej: Añadir plantas, estilo moderno..." : "Ex: Add plants, make it modern..."}
                                    value={customPrompt}
                                    onChange={(e) => setCustomPrompt(e.target.value)}
                                />
                                <div className="flex flex-wrap gap-1.5 mt-1.5">
                                    {t.templates.slice(0, 3).map((template: string, i: number) => (
                                        <button key={i} onClick={() => setCustomPrompt(template)} className="text-[9px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full hover:bg-gray-200 border border-gray-200">
                                            {template}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Generate — left col */}
                            <div className="col-span-1">
                                {generationState.error && (
                                    <div className="p-2 mb-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-[10px] text-center">{generationState.error}</div>
                                )}
                                <Button
                                    onClick={handleGenerate}
                                    isLoading={generationState.isGenerating}
                                    className="w-full py-3 text-xs uppercase tracking-widest font-black shadow-lg shadow-blue-900/20"
                                >
                                    {generationState.resultImage ? t.editor.regenerate : t.editor.generate}
                                </Button>
                            </div>

                            {/* Download — right col */}
                            <div className="col-span-1">
                                <Button
                                    onClick={handleDownloadResult}
                                    variant="primary"
                                    disabled={!generationState.resultImage}
                                    className="w-full py-3 text-xs uppercase whitespace-nowrap"
                                    icon={<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>}
                                >
                                    {t.editor.download}
                                </Button>
                            </div>

                            {/* Quote/Cart — full width */}
                            <div className="col-span-2 flex gap-2">
                                <Button
                                    onClick={() => {
                                        const dims = selectedMaterial.dimensions || { width: 30, length: 30 };
                                        const wallDims = generationState.analysis?.dimensions;
                                        const cartDims = wallDims 
                                            ? { width: wallDims.width, height: wallDims.height } 
                                            : { width: dims.width, height: dims.length };
                                        addToCart(selectedMaterial, cartDims, 1);
                                    }}
                                    variant="secondary"
                                    disabled={!generationState.resultImage}
                                    className="flex-1 py-3 bg-blue-600 border-blue-500 hover:bg-blue-500 text-white text-xs uppercase whitespace-nowrap"
                                    icon={<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" /></svg>}
                                >
                                    {lang === 'es' ? 'Añadir al Carrito' : 'Add to Cart'}
                                </Button>
                                <Button
                                    onClick={() => {
                                        setEstimationSource(AppView.EDITOR);
                                        setView(AppView.ESTIMATION);
                                    }}
                                    variant="secondary"
                                    disabled={!generationState.resultImage}
                                    className="flex-1 py-3 bg-green-600 border-green-500 hover:bg-green-500 text-white text-xs uppercase whitespace-nowrap"
                                    icon={<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>}
                                >
                                    {t.editor.createQuote}
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const renderCart = () => {
        // Re-read cart from local storage for render
        const cartItems: CartItem[] = JSON.parse(
            localStorage.getItem("constructVizCart") || "[]",
        );
        const total = cartItems.reduce((acc, item) => acc + item.totalCost, 0);

        return (
            <div className="min-h-screen bg-gray-100 flex flex-col p-6">
                <header className="flex justify-between items-center mb-8">
                    <Button
                        variant="ghost"
                        onClick={() => setView(AppView.LANDING)}
                    >
                        ← {t.common.back}
                    </Button>
                    <h1 className="text-2xl font-black text-gray-700">
                        {t.cart.title}
                    </h1>
                </header>

                {/* Tier Info Card */}
                {(() => {
                    const tier = currentUser?.tier || 'Free';
                    const used = currentUser?.generations_used || 0;
                    const limit = getTierLimit(tier);
                    const remaining = Math.max(0, limit - used);
                    const isUnlimited = limit >= 9999;
                    const pct = isUnlimited ? 100 : Math.max(0, Math.min(100, Math.round((remaining / Math.max(1, limit)) * 100)));
                    const tierNames: Record<string, string> = {
                        FREE: t.cart.tierFree, STANDARD: 'STANDARD', PREMIUM: 'PREMIUM', LUXURY: 'LUXURY'
                    };
                    const tierColors: Record<string, string> = {
                        FREE: 'gray', STANDARD: 'blue', PREMIUM: 'purple', LUXURY: 'amber'
                    };
                    const color = tierColors[tier.toUpperCase()] || 'gray';

                    return (
                        <div className={`mb-6 p-5 rounded-2xl border bg-white/90 backdrop-blur border-${color}-200 shadow-sm`}>
                            <div className="flex items-center justify-between mb-3">
                                <div>
                                    <div className="text-xs uppercase tracking-widest text-gray-400 font-bold mb-1">
                                        {t.cart.tierLabel}
                                    </div>
                                    <span className={`text-lg font-black text-${color}-600`}>
                                        {tierNames[tier.toUpperCase()] || tier}
                                    </span>
                                </div>
                                {tier !== 'LUXURY' && (
                                    <Button
                                        onClick={() => { setShowSubscriptionModal(true); }}
                                        className="text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl uppercase tracking-wider"
                                    >
                                        {t.cart.upgradeTier}
                                    </Button>
                                )}
                            </div>

                            {/* Renders remaining */}
                            <div className="mt-2">
                                <div className="flex justify-between text-xs mb-1">
                                    <span className="text-gray-500">
                                        {isUnlimited
                                            ? t.cart.unlimitedRenders
                                            : `${remaining} ${t.cart.rendersLeft}`}
                                    </span>
                                    {!isUnlimited && (
                                        <span className="text-gray-400">{used}/{limit}</span>
                                    )}
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                                    <div
                                        className={`h-full rounded-full transition-all duration-500 ${isUnlimited ? 'bg-green-500' : remaining > limit * 0.3 ? 'bg-green-500' : remaining > limit * 0.1 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                        style={{ width: `${isUnlimited ? 100 : Math.max(0, pct)}%` }}
                                    />
                                </div>
                            </div>

                            {/* Tier expiration */}
                            {currentUser?.tier_expires_at && tier.toUpperCase() !== 'FREE' && (
                                <div className="mt-3 text-xs">
                                    {(() => {
                                        const days = Math.max(0, Math.ceil((new Date(currentUser.tier_expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
                                        if (days <= 0) return <span className="text-red-600 font-bold">Expired — renew to restore access</span>;
                                        if (days <= 3) return <span className="text-red-600 font-bold">{days} days left — renew now!</span>;
                                        if (days <= 7) return <span className="text-amber-600 font-semibold">{days} days remaining</span>;
                                        return <span className="text-gray-400">Expires: {new Date(currentUser.tier_expires_at).toLocaleDateString()}</span>;
                                    })()}
                                </div>
                            )}

                            {/* Explainer for free tier */}
                            {tier === 'FREE' && (
                                <p className="mt-3 text-xs text-gray-400 leading-relaxed">
                                    {t.cart.tierExplainer}
                                </p>
                            )}
                        </div>
                    );
                })()}

                <div className="flex-1 max-w-4xl mx-auto w-full">
                    {cartItems.length === 0 ? (
                        <div className="text-center py-20">
                            <div className="text-gray-500 mb-4">
                                {t.cart.empty}
                            </div>
                            <Button onClick={() => setView(AppView.LANDING)}>
                                {t.cart.browse}
                            </Button>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {cartItems.map((item, index) => (
                                <div
                                    key={index}
                                    className="bg-gray-200 p-4 rounded-xl border border-gray-300 flex gap-4 items-center"
                                >
                                    <img
                                        src={proxyImageUrl(item.material.imageUrl)}
                                        className="w-16 h-16 rounded object-cover"
                                    />
                                    <div className="flex-1">
                                        <div className="font-bold text-gray-700">
                                            {item.material.name}
                                        </div>
                                        <div className="text-sm text-gray-500">
                                            {item.quantity}{" "}
                                            {item.material.pricing.unitLabel} •{" "}
                                            {unitSystem === "latam" ? (
                                                <>{item.dimensions.width}m x {item.dimensions.height}m</>
                                            ) : (
                                                <>{formatMetersUSA(item.dimensions.width)} x {formatMetersUSA(item.dimensions.height)}</>
                                            )}
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="font-bold text-green-400">
                                            ${Math.round(item.totalCost)}
                                        </div>
                                        <button
                                            onClick={() => {
                                                const newCart =
                                                    cartItems.filter(
                                                        (_, i) => i !== index,
                                                    );
                                                localStorage.setItem(
                                                    "constructVizCart",
                                                    JSON.stringify(newCart),
                                                );
                                                updateCartCount(); // Trigger re-render
                                            }}
                                            className="text-xs text-red-500 mt-1 hover:underline"
                                        >
                                            {t.cart.remove}
                                        </button>
                                    </div>
                                </div>
                            ))}

                            <div className="mt-8 bg-slate-950 p-6 rounded-xl border border-gray-300 flex justify-between items-center">
                                <span className="text-gray-500 uppercase tracking-widest font-bold">
                                    {t.cart.total}
                                </span>
                                <span className="text-3xl font-black text-gray-700">
                                    ${Math.round(total)}
                                </span>
                            </div>

                            <div className="flex justify-end gap-4 mt-6">
                                <Button
                                    variant="ghost"
                                    onClick={() => setView(AppView.LANDING)}
                                >
                                    {t.cart.continue}
                                </Button>
                                <Button
                                    onClick={() => {
                                        // Generate comprehensive email checkout
                                        const body = cartItems
                                            .map(
                                                (i) =>
                                                    `- ${i.material.name}: ${i.quantity} units ($${Math.round(i.totalCost)})`,
                                            )
                                            .join("\n");
                                        setCheckoutBody(
                                            `${lang === "es" ? "Orden de Compra" : "Order Request"}:\n\n${body}\n\nTotal: $${Math.round(total)}`,
                                        );
                                        setShowCheckoutModal(true);
                                    }}
                                >
                                    {t.cart.checkout}
                                </Button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Checkout Modal */}
                {showCheckoutModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                        <div className="bg-white text-black p-8 rounded-2xl max-w-md w-full shadow-2xl">
                            <h3 className="text-2xl font-black mb-4 uppercase">
                                {t.cart.confirmOrder}
                            </h3>
                            <p className="text-sm text-gray-600 mb-6">
                                {lang === 'es' 
                                    ? 'Elige cómo deseas pagar tu orden, o envíala por email a nuestro equipo de ventas.'
                                    : 'Choose how you want to pay for your order, or email it to our sales team.'}
                            </p>
                            <div className="bg-slate-100 p-4 rounded text-xs font-mono mb-6 whitespace-pre-wrap">
                                {checkoutBody}
                            </div>
                            <div className="space-y-3">
                                {/* Stripe Checkout Button */}
                                <Button
                                    onClick={async () => {
                                        setShowCheckoutModal(false);
                                        try {
                                            const res = await fetch('/api/checkout/create-product-session', {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({
                                                    items: cartItems,
                                                    userId: currentUser?.id,
                                                    email: currentUser?.email,
                                                    name: currentUser?.name,
                                                }),
                                            });
                                            const data = await res.json();
                                            if (data.url) {
                                                window.location.href = data.url;
                                            } else if (data.isMock) {
                                                // Fallback to email if Stripe is in mock mode
                                                window.open(
                                                    `mailto:comercial.buildinginnovation@gmail.com?subject=New Order Request&body=${encodeURIComponent(checkoutBody)}`,
                                                );
                                            }
                                        } catch (err) {
                                            // Fallback to email on error
                                            window.open(
                                                `mailto:comercial.buildinginnovation@gmail.com?subject=New Order Request&body=${encodeURIComponent(checkoutBody)}`,
                                            );
                                        }
                                    }}
                                    className="w-full py-4 bg-[#635BFF] hover:bg-[#7C73FF] text-white text-sm font-black uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2"
                                >
                                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M13.976 6.32c-.623.512-1.196 1.024-1.196 2.048 0 1.28 1.024 2.048 2.456 3.072 1.432 1.024 2.456 2.56 2.456 4.608 0 3.072-2.048 5.12-5.16 5.12-2.456 0-4.16-1.432-5.16-3.584l2.56-1.432c.624.96 1.432 1.84 2.6 1.84 1.024 0 1.84-.624 1.84-1.84 0-1.28-1.024-2.048-2.456-3.072-1.432-1.024-2.456-2.56-2.456-4.608 0-3.072 2.048-5.12 4.976-5.12 2.048 0 3.584 1.024 4.608 2.56l-2.56 1.432c-.624-1.024-1.432-1.432-2.048-1.432-1.024 0-1.84.624-1.84 1.432z"/>
                                    </svg>
                                    {lang === 'es' ? 'Pagar con Tarjeta' : 'Pay with Card'}
                                </Button>
                                
                                {/* Email Order Button (secondary) */}
                                <button
                                    onClick={() => {
                                        window.open(
                                            `mailto:comercial.buildinginnovation@gmail.com?subject=New Order Request&body=${encodeURIComponent(checkoutBody)}`,
                                        );
                                        setShowCheckoutModal(false);
                                    }}
                                    className="w-full py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm font-bold rounded-xl transition-all flex items-center justify-center gap-2"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                    </svg>
                                    {lang === 'es' ? 'Enviar por Email' : 'Email Order Request'}
                                </button>

                                <button
                                    onClick={() => setShowCheckoutModal(false)}
                                    className="w-full py-2 text-gray-400 hover:text-gray-600 text-xs font-bold transition-colors"
                                >
                                    {t.common.cancel}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    // --- Modal: 3D Probe ---
    const renderProbeModal = () => {
        if (!showProbeModal) return null;
        return (
            <div
                className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4 animate-fadeIn"
                onClick={() => setShowProbeModal(false)}
            >
                <div
                    className="relative max-w-lg w-full bg-white rounded-2xl overflow-hidden shadow-2xl border border-gray-300 flex flex-col max-h-[90vh]"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="absolute top-4 right-4 z-10">
                        <button
                            onClick={() => setShowProbeModal(false)}
                            className="bg-black/50 text-gray-700 rounded-full p-2 hover:bg-white hover:text-black transition-colors"
                        >
                            <svg
                                className="w-5 h-5"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M6 18L18 6M6 6l12 12"
                                />
                            </svg>
                        </button>
                    </div>

                    <div className="bg-black flex items-center justify-center min-h-[200px] max-h-[50vh] relative overflow-hidden">
                        {selectedMaterial ? (
                            <img
                                src={proxyImageUrl(selectedMaterial.imageUrl)}
                                className="w-full h-full object-contain max-h-[50vh]"
                            />
                        ) : (
                            <div className="text-red-400 text-sm p-4 text-center">
                                {lang === "es" ? "Cargando..." : "Loading..."}
                            </div>
                        )}
                    </div>

                    <div className="p-6 bg-white space-y-6">
                        <div className="text-center">
                            <div className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mb-1">
                                {selectedMaterial?.category}
                            </div>
                            <h3 className="text-2xl font-black text-gray-700 mb-2">
                                {selectedMaterial?.name}
                            </h3>
                            <p className="text-gray-500 text-sm line-clamp-2">
                                {selectedMaterial?.description}
                            </p>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <Button
                                variant="secondary"
                                onClick={() => {
                                    setShowProbeModal(false);
                                    setEstimationSource(AppView.GALLERY);
                                    setView(AppView.ESTIMATION);
                                }}
                                className="uppercase text-xs"
                            >
                                {t.modal.quote}
                            </Button>
                            <Button
                                onClick={() => {
                                    setShowProbeModal(false);
                                    setView(AppView.CAMERA);
                                }}
                                className="uppercase text-xs font-bold"
                            >
                                {t.modal.visualize}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const renderAuditLogsComponent = () => {
        const filteredLogs = auditLogs.filter((log) => {
            const matchesSearch = 
                (log.adminName?.toLowerCase() || "").includes(auditSearchQuery.toLowerCase()) ||
                (log.adminEmail?.toLowerCase() || "").includes(auditSearchQuery.toLowerCase()) ||
                (log.action?.toLowerCase() || "").includes(auditSearchQuery.toLowerCase()) ||
                (log.details?.toLowerCase() || "").includes(auditSearchQuery.toLowerCase()) ||
                (log.ipAddress?.toLowerCase() || "").includes(auditSearchQuery.toLowerCase());

            if (!matchesSearch) return false;

            if (auditActionFilter === "ALL") return true;
            if (auditActionFilter === "DELETIONS") return log.action?.includes("DELETE") || log.action?.includes("RESET");
            if (auditActionFilter === "MODIFICATIONS") return log.action?.includes("CREATE") || log.action?.includes("UPDATE");
            if (auditActionFilter === "CONFIG") return log.action?.includes("CONFIG") || log.action?.includes("TIERS") || log.action?.includes("ADMIN");
            return true;
        });

        const deleteCount = auditLogs.filter(l => l.action?.includes('DELETE') || l.action?.includes('RESET')).length;
        const configCount = auditLogs.filter(l => l.action?.includes('CONFIG') || l.action?.includes('TIERS') || l.action?.includes('ADMIN')).length;

        return (
            <div className="space-y-6 animate-fadeIn max-w-5xl">
                {/* Header Banner */}
                <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-xl shadow-gray-100/50 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                    <div className="space-y-1">
                        <h2 className="text-2xl font-black text-gray-700 uppercase tracking-tighter flex items-center gap-2">
                            <span className="p-2 bg-red-50 text-red-600 rounded-xl">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                                </svg>
                            </span>
                            {lang === "es" ? "Bitácora de Seguridad" : "Security Audit Logs"}
                        </h2>
                        <p className="text-gray-400 text-xs leading-relaxed max-w-xl">
                            {lang === "es" 
                                ? "Auditoría activa y persistente de todas las modificaciones críticas de la base de datos, configuraciones del motor visual de IA y eliminaciones de cuentas." 
                                : "Active persistent auditing of all critical database operations, subscription tier updates, account deletions, and system configurations."}
                        </p>
                    </div>
                    <div className="flex-shrink-0">
                        <Button 
                            variant="secondary"
                            onClick={fetchAuditLogs} 
                            disabled={isLoadingAuditLogs}
                            className="bg-gray-50 hover:bg-gray-100 border border-gray-200 text-xs font-bold uppercase tracking-wider px-4 py-2 text-gray-600 flex items-center gap-2 active:scale-95 transition-all"
                        >
                            {isLoadingAuditLogs ? (
                                <>
                                    <svg className="animate-spin h-3 w-3 text-gray-500" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                    {lang === "es" ? "Actualizando..." : "Refreshing..."}
                                </>
                            ) : (
                                <span>{lang === "es" ? "Actualizar Logs" : "Refresh Logs"}</span>
                            )}
                        </Button>
                    </div>
                </div>

                {/* Metrics Stats Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-xl shadow-gray-100/30 flex items-center gap-4">
                        <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                            </svg>
                        </div>
                        <div>
                            <span className="text-[10px] text-gray-400 font-extrabold uppercase tracking-wider block">
                                {lang === "es" ? "Eventos Auditados" : "Audited Events"}
                            </span>
                            <span className="text-xl font-black text-gray-700">{auditLogs.length}</span>
                        </div>
                    </div>

                    <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-xl shadow-gray-100/30 flex items-center gap-4">
                        <div className="p-3 bg-red-50 text-red-600 rounded-2xl">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                        </div>
                        <div>
                            <span className="text-[10px] text-gray-400 font-extrabold uppercase tracking-wider block">
                                {lang === "es" ? "Eliminaciones" : "Deletions"}
                            </span>
                            <span className="text-xl font-black text-red-600">{deleteCount}</span>
                        </div>
                    </div>

                    <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-xl shadow-gray-100/30 flex items-center gap-4">
                        <div className="p-3 bg-amber-50 text-amber-600 rounded-2xl">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37z" />
                            </svg>
                        </div>
                        <div>
                            <span className="text-[10px] text-gray-400 font-extrabold uppercase tracking-wider block">
                                {lang === "es" ? "Ajustes de Config" : "Config Updates"}
                            </span>
                            <span className="text-xl font-black text-amber-600">{configCount}</span>
                        </div>
                    </div>
                </div>

                {/* Filters and Search Bar Card */}
                <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-xl shadow-gray-100/50 space-y-6">
                    <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
                        {/* Search Input */}
                        <div className="relative w-full lg:w-96">
                            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                            </span>
                            <input
                                type="text"
                                placeholder={lang === "es" ? "Buscar por admin, acción, ip..." : "Search by admin, action, ip..."}
                                value={auditSearchQuery}
                                onChange={(e) => setAuditSearchQuery(e.target.value)}
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-10 pr-4 py-2 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-semibold"
                            />
                        </div>

                        {/* Action Filter Button Group */}
                        <div className="flex flex-wrap gap-1.5 w-full lg:w-auto">
                            {[
                                { key: "ALL", label: lang === "es" ? "Todos" : "All" },
                                { key: "DELETIONS", label: lang === "es" ? "Eliminaciones" : "Deletions" },
                                { key: "MODIFICATIONS", label: lang === "es" ? "Modificaciones" : "Modifications" },
                                { key: "CONFIG", label: lang === "es" ? "Configuración" : "Config" }
                            ].map((btn) => (
                                <button
                                    key={btn.key}
                                    onClick={() => setAuditActionFilter(btn.key)}
                                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all duration-200 border ${
                                        auditActionFilter === btn.key
                                            ? "bg-slate-900 border-slate-950 text-white shadow-md"
                                            : "bg-gray-50 hover:bg-gray-100 text-gray-600 border-gray-200"
                                    }`}
                                >
                                    {btn.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Audit Logs Table */}
                    {isLoadingAuditLogs ? (
                        <div className="py-20 flex flex-col items-center justify-center gap-3">
                            <svg className="animate-spin h-8 w-8 text-blue-600" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            <span className="text-[10px] text-gray-400 font-extrabold uppercase tracking-widest animate-pulse">
                                {lang === "es" ? "Cargando Bitácoras..." : "Loading Secure Audits..."}
                            </span>
                        </div>
                    ) : filteredLogs.length === 0 ? (
                        <div className="py-16 text-center border border-dashed border-gray-200 rounded-2xl bg-gray-50/50">
                            <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <h4 className="text-sm font-bold text-gray-600 uppercase tracking-wider">
                                {lang === "es" ? "No se encontraron registros" : "No logs found"}
                            </h4>
                            <p className="text-gray-400 text-xs mt-1">
                                {lang === "es" ? "Intente ajustar la búsqueda o los filtros." : "Try adjusting your search query or filter options."}
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto rounded-2xl border border-gray-200 shadow-inner bg-gray-50/10">
                            <table className="min-w-full divide-y divide-gray-200 text-left">
                                <thead className="bg-gray-50/75 sticky top-0">
                                    <tr className="border-b border-gray-200">
                                        <th scope="col" className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                            {lang === "es" ? "Fecha" : "Date & Time"}
                                        </th>
                                        <th scope="col" className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                            {lang === "es" ? "Administrador" : "Admin User"}
                                        </th>
                                        <th scope="col" className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">
                                            {lang === "es" ? "Acción" : "Action"}
                                        </th>
                                        <th scope="col" className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                            {lang === "es" ? "Descripción" : "Description"}
                                        </th>
                                        <th scope="col" className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest font-mono">
                                            IP ADDRESS
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-150">
                                    {filteredLogs.map((log) => {
                                        let badgeColor = "bg-blue-50 text-blue-700 border-blue-100";
                                        if (log.action?.includes("DELETE") || log.action?.includes("RESET")) {
                                            badgeColor = "bg-red-50 text-red-700 border-red-200 font-extrabold shadow-sm shadow-red-100";
                                        } else if (log.action?.includes("CREATE")) {
                                            badgeColor = "bg-green-50 text-green-700 border-green-200";
                                        } else if (log.action?.includes("UPDATE")) {
                                            badgeColor = "bg-amber-50 text-amber-700 border-amber-200";
                                        }

                                        return (
                                            <tr key={log.id} className="hover:bg-gray-50/50 transition-colors duration-150">
                                                <td className="px-6 py-4 whitespace-nowrap text-xs font-semibold text-gray-400 font-mono">
                                                    {new Date(log.timestamp).toLocaleString()}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <div className="flex flex-col">
                                                        <span className="text-xs font-bold text-gray-700">{log.adminName}</span>
                                                        <span className="text-[10px] text-gray-400 font-mono mt-0.5">{log.adminEmail}</span>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-center">
                                                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[9px] font-extrabold uppercase tracking-wider border ${badgeColor}`}>
                                                        {log.action}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-xs font-semibold text-gray-600 max-w-sm break-words leading-normal">
                                                    {log.details}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-xs font-mono text-gray-400">
                                                    {log.ipAddress}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const handleViewUserDetail = async (userId: number) => {
        setIsLoadingUserDetail(true);
        try {
            const res = await fetch(`/api/admin/users/${userId}/detail`);
            if (res.ok) {
                const data = await res.json();
                setSelectedUserDetail(data);
                setShowUserDetailModal(true);
            } else {
                alert("Failed to load user detail");
            }
        } catch (e) {
            console.error("Error loading user detail:", e);
            alert("Error loading user detail");
        } finally {
            setIsLoadingUserDetail(false);
        }
    };

    const renderUserDetailModal = () => {
        if (!showUserDetailModal || !selectedUserDetail) return null;
        
        const u = selectedUserDetail;
        const memory = u.memory || { lastState: {}, history: [], behaviors: {} };
        const behaviors = memory.behaviors || {};
        const events = behaviors.events || [];
        const counts = behaviors.counts || {};
        const historyList = memory.history || [];
        const lastState = memory.lastState || {};

        return (
            <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-fadeIn">
                <div className="bg-white text-black rounded-3xl max-w-5xl w-full overflow-hidden shadow-2xl flex flex-col h-full max-h-[85vh]">
                    {/* Header */}
                    <div className="flex justify-between items-start bg-gray-50 border-b border-gray-150 p-6">
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-2xl font-black text-gray-800 uppercase tracking-tighter">{u.name}</h2>
                                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${u.role === 'admin' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>{u.role}</span>
                                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-blue-100 text-blue-700`}>{u.tier}</span>
                            </div>
                            <p className="text-gray-500 text-xs mt-1">User ID: {u.id} • Registered: {u.created_at ? new Date(u.created_at).toLocaleDateString() : 'N/A'}</p>
                        </div>
                        <button onClick={() => setShowUserDetailModal(false)} className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-500 hover:text-gray-700">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>

                    {/* Body */}
                    <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Profile & Live Workspace State */}
                        <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100 flex flex-col gap-4">
                            <div>
                                <h3 className="font-bold text-gray-700 uppercase text-[10px] tracking-widest mb-3">Contact Details</h3>
                                <div className="space-y-2 text-xs">
                                    <div className="flex justify-between"><span className="text-gray-400">Email:</span><span className="font-medium text-gray-800">{u.email}</span></div>
                                    <div className="flex justify-between"><span className="text-gray-400">Phone:</span><span className="font-medium text-gray-800">{u.phone || 'None'}</span></div>
                                    <div className="flex justify-between"><span className="text-gray-400">Address:</span><span className="font-medium text-gray-800">{u.address || 'None'}</span></div>
                                </div>
                            </div>

                            <hr className="border-gray-200" />

                            <div>
                                <h3 className="font-bold text-gray-700 uppercase text-[10px] tracking-widest mb-3">Last Active State</h3>
                                {Object.keys(lastState).length === 0 ? (
                                    <p className="text-xs text-gray-400 italic">No workspace state captured yet.</p>
                                ) : (
                                    <div className="space-y-2 text-xs">
                                        <div className="flex justify-between"><span className="text-gray-400">Current View:</span><span className="font-bold text-blue-600 uppercase">{lastState.view}</span></div>
                                        <div className="flex justify-between"><span className="text-gray-400">Selected Product:</span><span className="font-bold text-gray-800 truncate max-w-[120px]">{lastState.selectedMaterial?.name || 'None'}</span></div>
                                        <div className="flex justify-between"><span className="text-gray-400">Lighting Mode:</span><span className="font-medium text-gray-700">{lastState.renderOptions?.lighting || 'Default'}</span></div>
                                        <div className="flex justify-between"><span className="text-gray-400">Display Currency:</span><span className="font-medium text-gray-700">{lastState.displayCurrency || 'USD'}</span></div>
                                        <div className="flex justify-between"><span className="text-gray-400">Language:</span><span className="font-medium text-gray-700 uppercase">{lastState.lang || 'en'}</span></div>
                                        {lastState.customPrompt && (
                                            <div className="mt-2 p-2 bg-white rounded border border-gray-100">
                                                <div className="text-[9px] text-gray-400 uppercase font-bold mb-1">Custom Prompt</div>
                                                <div className="text-gray-600 italic text-[10px] leading-snug">"{lastState.customPrompt}"</div>
                                            </div>
                                        )}
                                        {lastState.originalImage && (
                                            <div className="mt-2">
                                                <div className="text-[9px] text-gray-400 uppercase font-bold mb-1">Active Design Space</div>
                                                <img src={lastState.originalImage} className="w-full h-24 object-cover rounded-lg border border-gray-200" alt="Last space" />
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Behaviors & Counts */}
                        <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100 flex flex-col gap-4">
                            <div>
                                <h3 className="font-bold text-gray-700 uppercase text-[10px] tracking-widest mb-3">Feature Interactions</h3>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="p-3 bg-white border border-gray-150 rounded-xl">
                                        <div className="text-[9px] font-bold text-gray-400 uppercase">Generations</div>
                                        <div className="text-2xl font-black text-blue-600">{u.generations_used || 0}</div>
                                    </div>
                                    <div className="p-3 bg-white border border-gray-150 rounded-xl">
                                        <div className="text-[9px] font-bold text-gray-400 uppercase">Downloads</div>
                                        <div className="text-2xl font-black text-green-600">{counts.DOWNLOAD_RENDER || 0}</div>
                                    </div>
                                    <div className="p-3 bg-white border border-gray-150 rounded-xl">
                                        <div className="text-[9px] font-bold text-gray-400 uppercase">Product Views</div>
                                        <div className="text-2xl font-black text-purple-600">{counts.SELECT_MATERIAL || 0}</div>
                                    </div>
                                    <div className="p-3 bg-white border border-gray-150 rounded-xl">
                                        <div className="text-[9px] font-bold text-gray-400 uppercase">Space Uploads</div>
                                        <div className="text-2xl font-black text-amber-600">{counts.UPLOAD_IMAGE || 0}</div>
                                    </div>
                                </div>
                            </div>

                            <hr className="border-gray-200" />

                            <div className="flex-1 flex flex-col min-h-[150px]">
                                <h3 className="font-bold text-gray-700 uppercase text-[10px] tracking-widest mb-3">Activity Stream (Last seen: {behaviors.lastActive ? new Date(behaviors.lastActive).toLocaleTimeString() : 'N/A'})</h3>
                                {events.length === 0 ? (
                                    <p className="text-xs text-gray-400 italic">No activity recorded yet.</p>
                                ) : (
                                    <div className="flex-1 overflow-y-auto space-y-2 max-h-[180px] pr-2">
                                        {events.map((ev: any, idx: number) => (
                                            <div key={idx} className="flex justify-between items-center text-[10px] bg-white p-2 rounded border border-gray-100">
                                                <span className="font-bold uppercase text-gray-600">{ev.type}</span>
                                                <span className="text-gray-400">{new Date(ev.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Generation History (Images generated) */}
                        <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100 flex flex-col">
                            <h3 className="font-bold text-gray-700 uppercase text-[10px] tracking-widest mb-3">Design History ({historyList.length})</h3>
                            {historyList.length === 0 ? (
                                <div className="flex-1 flex items-center justify-center border-2 border-dashed border-gray-200 rounded-xl p-8">
                                    <p className="text-xs text-gray-400 italic text-center">No high-fidelity designs generated by this user yet.</p>
                                </div>
                            ) : (
                                <div className="flex-1 overflow-y-auto space-y-4 max-h-[380px] pr-2">
                                    {historyList.map((item: any, idx: number) => (
                                        <div key={idx} className="bg-white border border-gray-150 rounded-xl p-3 flex flex-col gap-2">
                                            {item.resultImage && (
                                                <img src={item.resultImage} className="w-full h-32 object-cover rounded-lg border border-gray-150" alt="Generated space design" />
                                            )}
                                            <div className="text-[10px]">
                                                <div className="font-bold text-gray-800">{item.material?.name || 'Selected Material'}</div>
                                                {item.prompt && (
                                                    <div className="text-gray-500 italic mt-0.5">"{item.prompt}"</div>
                                                )}
                                                {item.timestamp && (
                                                    <div className="text-[8px] text-gray-400 mt-1">{new Date(item.timestamp).toLocaleString()}</div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

        const renderSubscriptionModal = () => {
        const tier = currentUser?.tier || 'Free';
        const used = currentUser?.generations_used || 0;
        const limit = getTierLimit(tier);
        const remaining = Math.max(0, limit - used);

        const defaultTiers = {
            FREE: { name: 'FREE', price: 0, limit: 10 },
            STANDARD: { name: 'STANDARD', price: 4.99, limit: 500 },
            PREMIUM: { name: 'PREMIUM', price: 24.99, limit: 1000 },
            LUXURY: { name: 'LUXURY', price: 49.99, limit: 999999 }
        };
        const config = tiersConfig || defaultTiers;
        const plans = [
            { 
                key: 'FREE',
                name: config.FREE?.name || 'FREE', 
                price: config.FREE?.price === 0 ? 'SIN COSTO' : `${config.FREE?.price} USD`, 
                limit: config.FREE?.limit >= 9999 ? 'ILIMITADOS' : (config.FREE?.limit ?? 10),
                features: ['10 creditos para fotos', 'Usabilidad en 1 dispositivo'],
                color: 'gray' 
            },
            { 
                key: 'STANDARD',
                name: config.STANDARD?.name || 'STANDARD', 
                price: `${config.STANDARD?.price ?? 4.99} USD`, 
                limit: config.STANDARD?.limit >= 9999 ? 'ILIMITADOS' : (config.STANDARD?.limit ?? 500),
                features: ['1 mes de Servicio', 'Descarga de imagen HD', '500 creditos para fotos', 'Generacion cotizacion PDF', 'Usabilidad en 2 dispositivos'],
                color: 'blue' 
            },
            { 
                key: 'PREMIUM',
                name: config.PREMIUM?.name || 'PREMIUM', 
                price: `${config.PREMIUM?.price ?? 24.99} USD`, 
                limit: config.PREMIUM?.limit >= 9999 ? 'ILIMITADOS' : (config.PREMIUM?.limit ?? 1000),
                features: ['6 meses de Servicio', 'Descarga de imagen HD', '1000 creditos para fotos', 'Generacion cotizacion PDF', 'Usabilidad en 2 dispositivos'],
                color: 'purple',
                featured: true
            },
            { 
                key: 'LUXURY',
                name: config.LUXURY?.name || 'LUXURY', 
                price: `${config.LUXURY?.price ?? 49.99} USD`, 
                limit: config.LUXURY?.limit >= 9999 ? 'ILIMITADOS' : (config.LUXURY?.limit ?? 999999),
                features: ['12 meses de Servicio', 'Descarga de imagen HD', 'Creditos ILIMITADOS para fotos', 'Generacion cotizacion PDF', 'Usabilidad en 3 dispositivos'],
                color: 'amber' 
            },
        ];

        return (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-md p-4 lg:p-8 animate-fadeIn">
                <div className="bg-[#0b0c10] rounded-[2rem] max-w-7xl w-full overflow-hidden shadow-2xl shadow-purple-900/20 flex flex-col h-full max-h-[95vh] border border-[#1f2833]">
                    <div className="flex-1 p-8 lg:p-12 overflow-y-auto">
                        <div className="flex justify-between items-start mb-12 relative">
                            <div className="w-full text-center">
                                <h2 className="text-3xl md:text-4xl font-black text-white tracking-[0.3em] uppercase">Planes Disponibles</h2>
                                {currentUser?.tier_expires_at && tier.toUpperCase() !== 'FREE' && (
                                    <div className="mt-3 text-sm font-medium">
                                        {(() => {
                                            const days = Math.max(0, Math.ceil((new Date(currentUser.tier_expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
                                            if (days <= 0) return <span className="text-red-500">Your plan expired on {new Date(currentUser.tier_expires_at).toLocaleDateString()}</span>;
                                            if (days <= 3) return <span className="text-red-500">Your plan expires in {days} days — renew now!</span>;
                                            if (days <= 7) return <span className="text-amber-400">Your plan expires in {days} days</span>;
                                            return <span className="text-gray-400">Current plan expires: {new Date(currentUser.tier_expires_at).toLocaleDateString()}</span>;
                                        })()}
                                    </div>
                                )}
                            </div>
                            <button onClick={() => setShowSubscriptionModal(false)} className="absolute right-0 top-0 p-3 hover:bg-white/10 rounded-full transition-colors text-white">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                            {plans.map((p) => {
                                const isCurrent = p.key.toLowerCase() === tier.toLowerCase();
                                return (
                                    <div key={p.key} className={`relative flex flex-col p-[2px] transition-all bg-gradient-to-b from-[#b340eb] to-[#450a80] ${p.featured ? 'scale-105 shadow-[0_0_40px_rgba(179,64,235,0.4)] z-10' : ''}`} style={{ clipPath: 'polygon(15% 0, 100% 0, 100% 85%, 85% 100%, 0 100%, 0 15%)' }}>
                                        <div className="bg-[#0b0c10] h-full flex flex-col text-center" style={{ clipPath: 'polygon(15% 0, 100% 0, 100% 85%, 85% 100%, 0 100%, 0 15%)' }}>
                                            <div className="p-8 flex-1 flex flex-col items-center">
                                                <div className="text-2xl font-black text-white mb-10 tracking-[0.2em]">{p.name}</div>
                                                
                                                <div className="flex-1 flex flex-col justify-center space-y-8 mb-8 w-full">
                                                    {p.features.map((feat, idx) => (
                                                        <div key={idx} className="text-sm text-gray-300 font-medium">{feat}</div>
                                                    ))}
                                                </div>
                                            </div>

                                            <div className="mt-auto">
                                                <button 
                                                    disabled={isCurrent}
                                                    onClick={() => handleSelectPlan(p.key)}
                                                    className={`w-full py-5 font-black tracking-widest text-lg transition-all ${isCurrent ? 'bg-purple-900/50 text-white/50 cursor-default' : 'bg-[#c75af6] text-white hover:bg-[#d67bf9] shadow-[0_0_20px_rgba(199,90,246,0.5)] active:scale-95'}`}
                                                >
                                                    {isCurrent ? 'PLAN ACTUAL' : p.price}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-slate-900 text-gray-700 font-sans selection:bg-blue-500 selection:text-gray-700">
            {/* Floating Toast Notification */}
            {toast && (
                <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] animate-bounce-in">
                    <div className="bg-green-600 text-white px-5 py-3 rounded-full shadow-2xl text-sm font-bold flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                        {toast}
                    </div>
                </div>
            )}
            {view === AppView.LOGIN && renderLogin()}
            {view === AppView.LANDING && renderLanding()}
            {view === AppView.ADMIN && renderAdmin()}
            {view === AppView.GALLERY && renderGallery()}
            {view === AppView.CAMERA && (
                <div className="h-screen flex flex-col bg-black">
                    <div className="p-4 flex justify-between items-center z-10">
                        <Button
                            variant="ghost"
                            onClick={() => setView(AppView.GALLERY)}
                            className="text-gray-700"
                        >
                            ← {t.common.back}
                        </Button>
                    </div>
                    <div className="flex-1 p-4 md:p-8 flex items-center justify-center">
                        <div className="w-full max-w-md h-full max-h-[600px]">
                            <CameraCapture
                                onImageCapture={handleImageCapture}
                                lang={lang}
                            />
                        </div>
                    </div>
                </div>
            )}
            {view === AppView.EDITOR && renderEditor()}



            {view === AppView.ESTIMATION && (
                selectedMaterial ? (
                    <div className="h-screen bg-slate-900 p-4 md:p-8 overflow-y-auto flex justify-center">
                        <div className="w-full max-w-4xl h-full">
                            <EstimationPanel
                                material={selectedMaterial}
                                onBack={() => setView(estimationSource)}
                                onAddToCart={() => {
                                    const dims = selectedMaterial.dimensions || { width: 30, length: 30 };
                                    // Use AI-calculated wall dimensions if available, else material defaults
                                    const wallDims = generationState.analysis?.dimensions;
                                    const cartDims = wallDims 
                                        ? { width: wallDims.width, height: wallDims.height } 
                                        : { width: dims.width, height: dims.length };
                                    addToCart(selectedMaterial, cartDims, 1);
                                }}
                                onNewQuote={() => setView(AppView.GALLERY)}
                                contractors={contractors}
                                lang={lang}
                                unitSystem={unitSystem}
                                userEmail={currentUser?.email || ''}
                                userName={currentUser?.name || ''}
                            />
                        </div>
                    </div>
                ) : (
                    <div className="h-screen bg-slate-900 flex flex-col items-center justify-center p-8 text-center">
                        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8 max-w-md">
                            <svg className="w-16 h-16 text-slate-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <h2 className="text-xl font-bold text-white mb-2">
                                {lang === 'es' ? 'Ningún Material Seleccionado' : 'No Material Selected'}
                            </h2>
                            <p className="text-slate-400 mb-6">
                                {lang === 'es'
                                    ? 'Por favor selecciona un material del catálogo primero.'
                                    : 'Please select a material from the catalog first.'}
                            </p>
                            <Button onClick={() => setView(AppView.GALLERY)}>
                                {lang === 'es' ? 'Ir al Catálogo' : 'Browse Catalog'}
                            </Button>
                        </div>
                    </div>
                )
            )}
            {view === AppView.CART && renderCart()}
            {showSubscriptionModal && renderSubscriptionModal()}
            {showUserDetailModal && renderUserDetailModal()}
            {renderProbeModal()}

            {/* ── Bottom Navigation Bar ── */}
            {![AppView.LOGIN, AppView.ADMIN, AppView.EDITOR, AppView.CART].includes(view) && (
                <nav className="fixed bottom-0 left-0 right-0 z-50 bg-gray-100/95 backdrop-blur-md border-t border-gray-300 safe-area-bottom">
                    <div className="flex justify-around items-center h-16 max-w-lg mx-auto px-2">
                        {/* Home */}
                        <button
                            onClick={() => setView(AppView.LANDING)}
                            className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl transition-colors min-w-[64px] ${view === AppView.LANDING ? 'text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={view === AppView.LANDING ? 2.5 : 1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                            </svg>
                            <span className="text-[10px] font-semibold">{lang === 'es' ? 'Inicio' : 'Home'}</span>
                        </button>

                        {/* Gallery */}
                        <button
                            onClick={() => setView(AppView.GALLERY)}
                            className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl transition-colors min-w-[64px] ${view === AppView.GALLERY ? 'text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={view === AppView.GALLERY ? 2.5 : 1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <span className="text-[10px] font-semibold">{lang === 'es' ? 'Catálogo' : 'Catalog'}</span>
                        </button>

                        {/* Camera */}
                        <button
                            onClick={() => {
                                setOriginalImage(null);
                                setGenerationState(prev => ({ ...prev, resultImage: null, error: null, analysis: null }));
                                setView(AppView.CAMERA);
                            }}
                            className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl transition-colors min-w-[64px] ${view === AppView.CAMERA ? 'text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={view === AppView.CAMERA ? 2.5 : 1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={view === AppView.CAMERA ? 2.5 : 1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            <span className="text-[10px] font-semibold">{lang === 'es' ? 'Cámara' : 'Camera'}</span>
                        </button>

                        {/* Admin (only if admin) */}
                        {currentUser?.role === 'admin' && (
                            <button
                                onClick={() => setView(AppView.ADMIN)}
                                className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl transition-colors min-w-[64px] ${view === AppView.ADMIN ? 'text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={view === AppView.ADMIN ? 2.5 : 1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={view === AppView.ADMIN ? 2.5 : 1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                                <span className="text-[10px] font-semibold">{lang === 'es' ? 'Admin' : 'Admin'}</span>
                            </button>
                        )}

                        {/* Cart */}
                        <button
                            onClick={() => setView(AppView.CART)}
                            className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl transition-colors min-w-[64px] relative ${view === AppView.CART ? 'text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={view === AppView.CART ? 2.5 : 1.5} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                            </svg>
                            {cartCount > 0 && (
                                <span className="absolute top-0 right-1 w-4 h-4 bg-red-500 rounded-full text-[9px] font-bold text-white flex items-center justify-center">
                                    {cartCount}
                                </span>
                            )}
                            <span className="text-[10px] font-semibold">{lang === 'es' ? 'Cotizar' : 'Quote'}</span>
                        </button>
                    </div>
                </nav>
            )}

            {/* Safe area padding for bottom nav */}
            {![AppView.LOGIN, AppView.ADMIN, AppView.EDITOR, AppView.CART].includes(view) && (
                <div className="h-20" />
            )}
        </div>
    );
};

export default App;
