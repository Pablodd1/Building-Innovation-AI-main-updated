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
import { SmartView } from "./components/SmartView";
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

    // Sync unit system with language
    useEffect(() => {
        setUnitSystem(lang === "es" ? "latam" : "usa");
    }, [lang]);

    // Load persisted user on mount
    useEffect(() => {
        try {
            const saved = localStorage.getItem('constructviz_user');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed && parsed.id) {
                    setCurrentUser(parsed);
                    setView(AppView.LANDING);
                }
            }
        } catch (e) {
            console.warn('Failed to load persisted user:', e);
        }
    }, []);

    // Authentication State
    const [currentUser, setCurrentUser] = useState<User | null>(null);
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
    const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(
        null,
    );
    const [displayCurrency, setDisplayCurrency] = useState<"USD" | "COP">(
        "USD",
    );

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

    // Search State
    const [searchQuery, setSearchQuery] = useState("");

    const [allUsers, setAllUsers] = useState<User[]>([]);
    const [isLoadingUsers, setIsLoadingUsers] = useState(false);
    const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);

    // Admin Form State
    const [adminTab, setAdminTab] = useState<
        "MATERIALS" | "CONTRACTORS" | "PURCHASES" | "USERS" | "SETTINGS"
    >("MATERIALS");

    useEffect(() => {
        if (view === AppView.ADMIN && adminTab === "USERS") {
            fetchAllUsers();
        }
    }, [view, adminTab]);

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

    const [newAdminForm, setNewAdminForm] = useState({ name: "", email: "", password: "" });
    const [isCreatingAdmin, setIsCreatingAdmin] = useState(false);

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
                fetchAllUsers();
            }
        } catch (e) {
            console.error("Update tier error:", e);
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
        };
        img.src = imgSrc;
    };
    const [isEditing, setIsEditing] = useState(false);
    const [editForm, setEditForm] = useState<Partial<Material>>({});

    const handleSelectPlan = async (newTier: string) => {
        if (!currentUser) return;
        
        // Simulated Checkout Flow
        const confirmMsg = lang === 'es' 
            ? `¿Confirmas la suscripción al plan ${newTier}? (Simulación de pago)` 
            : `Confirm subscription to ${newTier} plan? (Payment Simulation)`;
            
        if (confirm(confirmMsg)) {
            try {
                const res = await fetch(`/api/admin/users/${currentUser.id}/tier`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ tier: newTier }),
                });
                if (res.ok) {
                    const updatedUser = await res.json();
                    setCurrentUser({ ...currentUser, tier: updatedUser.tier });
                    alert(lang === 'es' ? "¡Suscripción actualizada!" : "Subscription updated!");
                    setShowSubscriptionModal(false);
                }
            } catch (e) {
                console.error("Subscription error:", e);
            }
        }
    };
    const [contractorForm, setContractorForm] = useState<Partial<Contractor>>(
        {},
    );
    const [originalImage, setOriginalImage] = useState<string | null>(null);
    const [customPrompt, setCustomPrompt] = useState<string>("");

    const [renderOptions, setRenderOptions] = useState<RenderOptions>({
        lighting: "NATURAL",
        viewAngle: "PERSPECTIVE",
        declutter: false,
    });

    const [editorTab, setEditorTab] = useState<"CONFIGURE" | "ANALYZE">(
        "CONFIGURE",
    );

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

    const [showProbeModal, setShowProbeModal] = useState(false);
    const [showSmartView, setShowSmartView] = useState(false);
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);

    const [showCheckoutModal, setShowCheckoutModal] = useState(false);
    const [checkoutBody, setCheckoutBody] = useState("");

    // Admin pagination and multi-select state
    const [selectedMaterialIds, setSelectedMaterialIds] = useState<Set<string>>(
        new Set(),
    );
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;
    const [adminCollectionFilter, setAdminCollectionFilter] = useState<
        "All" | "Interior" | "Exterior"
    >("All");

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

        // For local paths that failed, try prepending origin
        if (originalSrc.startsWith('/')) {
            target.setAttribute('data-error-fixed', 'true');
            target.src = window.location.origin + originalSrc;
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
                        
                        // Prioritize local embedded high-fidelity images
                        let imageUrl = m.image_url || m.imageUrl || "";
                        if (refCode) {
                            imageUrl = `/products/${refCode}.webp`;
                        } else {
                            imageUrl = proxyImageUrl(imageUrl);
                        }

                        return {
                            id: String(m.id),
                            refCode,
                            name: m.name || "",
                            category: m.category || "General",
                            subcategory: m.subcategory || "",
                            description: m.description || "",
                            imageUrl,
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
                    setMaterialsLoading(false);
                    return;
                }
            }
        } catch (e) {
            console.warn("API materials unavailable, trying local manifest...");
        }

        try {
            // Tier 2: Local embedded manifest — proxy image URLs for browser
            const localRes = await fetch("/data/products.json");
            if (localRes.ok) {
                const localData = await localRes.json();
                if (Array.isArray(localData) && localData.length > 0) {
                    const proxied = localData.map((m: any) => {
                        const rawUsage = m.usage || "Interior";
                        const normalizedUsage = rawUsage.charAt(0).toUpperCase() + rawUsage.slice(1).toLowerCase();
                        const refCode = m.ref_code || m.refCode || "";
                        
                        // Prioritize local embedded high-fidelity images
                        let imageUrl = m.image_url || m.imageUrl || "";
                        if (refCode) {
                            imageUrl = `/products/${refCode}.webp`;
                        } else {
                            imageUrl = proxyImageUrl(imageUrl);
                        }

                        return {
                            ...m,
                            usage: normalizedUsage,
                            imageUrl: imageUrl,
                        };
                    });
                    setMaterials(proxied);
                    setMaterialsLoading(false);
                    return;
                }
            }
        } catch (e) {
            console.warn("Local manifest unavailable, falling back to constants...");
        }

        // Tier 3: Last resort fallback to hardcoded MATERIALS
        setMaterials(MATERIALS);
        setMaterialsLoading(false);
    }, []);

    useEffect(() => {
        loadMaterialsFromDB();

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
        // Removed 3D Probe Generation as per user request (too slow/non-functional)
    };

    const handleImageCapture = (file: File) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            setOriginalImage(reader.result as string);
            setView(AppView.EDITOR);
            setHistory([]);
            setHistoryIndex(-1);
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
            const limit = currentUser.tier === 'Free' ? 5 : currentUser.tier === 'Pro' ? 50 : 9999;
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
                }}
                className={`px-3 py-1 text-xs font-bold rounded transition-colors ${lang === "en" ? "bg-blue-600 text-white shadow" : "text-gray-500 hover:text-gray-700"}`}
            >
                EN {unitSystem === "usa" && " (ft/in)"}
            </button>
            <button
                onClick={() => {
                    setLang("es");
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
                                role: 'customer',
                                tier: 'Free',
                                generations_used: 0,
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
                <div className="text-gray-700 text-sm">
                    {currentUser && (
                        <span className="font-medium">{currentUser.name}</span>
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
                        onClick={() => handleStart("Interior")}
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
                        onClick={() => handleStart("Exterior")}
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
                    <div className="flex gap-2">
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
                    </div>
                </div>

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
                    <div className="space-y-6">
                        <div className="bg-gray-200 p-6 rounded-xl border border-gray-300">
                            <h3 className="text-lg font-bold text-gray-700 mb-4">
                                Add Installer
                            </h3>
                            <div className="flex gap-4 mb-4">
                                <input
                                    className="bg-gray-200 border border-gray-300 rounded p-2 text-gray-700 flex-1"
                                    placeholder="Company Name"
                                    value={contractorForm.name || ""}
                                    onChange={(e) =>
                                        setContractorForm({
                                            ...contractorForm,
                                            name: e.target.value,
                                        })
                                    }
                                />
                                <input
                                    className="bg-gray-200 border border-gray-300 rounded p-2 text-gray-700 flex-1"
                                    placeholder="Region"
                                    value={contractorForm.region || ""}
                                    onChange={(e) =>
                                        setContractorForm({
                                            ...contractorForm,
                                            region: e.target.value,
                                        })
                                    }
                                />
                            </div>
                            <Button onClick={handleSaveContractor}>
                                Add Installer
                            </Button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {contractors.map((c) => (
                                <div
                                    key={c.id}
                                    className="bg-gray-200 p-4 rounded-xl border border-gray-300"
                                >
                                    <div className="font-bold text-gray-700">
                                        {c.name}
                                    </div>
                                    <div className="text-sm text-blue-400">
                                        {c.region}
                                    </div>
                                    <div className="text-xs text-gray-500 mt-2">
                                        {c.email}
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
                                                        style={{ width: `${Math.min(100, (u.generations_used / (u.tier === 'Free' ? 5 : u.tier === 'Pro' ? 50 : 9999)) * 100)}%` }}
                                                    ></div>
                                                </div>
                                                <span className="text-[10px] text-gray-500">{u.generations_used} gens</span>
                                            </td>
                                            <td className="p-4 text-right">
                                                <select 
                                                    className="bg-gray-200 border border-gray-300 rounded text-xs p-1"
                                                    value={u.tier}
                                                    onChange={(e) => handleUpdateUserTier(u.id, e.target.value)}
                                                >
                                                    <option value="Free">Free</option>
                                                    <option value="Pro">Pro</option>
                                                    <option value="Enterprise">Enterprise</option>
                                                </select>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {adminTab === "SETTINGS" && (
                    <div className="max-w-xl">
                        <div className="bg-gray-200 p-6 rounded-xl border border-gray-300">
                            <h3 className="text-lg font-bold text-gray-700 mb-4">
                                AI Configuration
                            </h3>
                            <p className="text-sm text-gray-500 mb-4">
                                {lang === "es"
                                    ? "La IA está configurada en el servidor. No se requiere clave de API en el navegador."
                                    : "AI is configured server-side. No API key required in the browser."}
                            </p>
                            <div className="bg-green-100 border border-green-300 rounded p-3 text-sm text-green-800">
                                ✅ {lang === "es" ? "Protección activa: la clave nunca se expone al cliente." : "Secure: key never exposed to client."}
                            </div>
                        </div>
                    </div>
                )}
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
                                        {currentUser.tier === 'Enterprise' ? 'Unlimited' : `${(currentUser.tier === 'Free' ? 5 : currentUser.tier === 'Pro' ? 50 : 9999) - (currentUser.generations_used || 0)} Renders`}
                                    </span>
                                    <svg className="w-3 h-3 text-blue-400 group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                                </button>
                            )}
                            <LanguageToggle />
                            <input
                                type="text"
                                placeholder="Search..."
                                className="hidden md:block bg-gray-200 border-none rounded-full px-4 py-2 text-sm text-gray-700 focus:ring-2 focus:ring-blue-500"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto p-4 md:p-6">
                    <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
                        {filtered.map((material) => (
                            <button
                                key={material.id}
                                onClick={() => handleSelectMaterial(material)}
                                className="group relative aspect-square rounded-2xl overflow-hidden bg-gray-200 border border-gray-300 hover:border-blue-500 hover:shadow-2xl hover:shadow-blue-900/20 transition-all text-left"
                            >
                                <img
                                    src={material.imageUrl}
                                    data-original-src={material.imageUrl}
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

                {/* Sidebar Controls */}
                <div className="w-full md:w-96 bg-white border-l border-gray-300 flex flex-col h-[40vh] md:h-full z-20 shadow-2xl">
                    <div className="p-4 border-b border-gray-300 flex items-center justify-between">
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
                                        {currentUser.tier === 'Enterprise' ? '∞' : (currentUser.tier === 'Free' ? 5 : currentUser.tier === 'Pro' ? 50 : 9999) - (currentUser.generations_used || 0)} Renders
                                    </span>
                                </button>
                            )}
                            <LanguageToggle />
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 space-y-8">
                        {/* Material Info */}
                        {selectedMaterial && (
                            <div className="flex flex-col gap-2 bg-gray-200 p-4 rounded-xl border border-gray-300">
                                <div className="flex items-center gap-4">
                                    <div
                                        className="relative group cursor-pointer"
                                        onClick={handleGenerateProbe}
                                    >
                                        <img
                                            src={selectedMaterial.imageUrl}
                                            data-original-src={selectedMaterial.imageUrl}
                                            onError={handleImageError}
                                            className="w-16 h-16 rounded-lg object-cover border border-gray-300"
                                        />
                                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg">
                                            <svg
                                                className="w-6 h-6 text-gray-700"
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                            >
                                                <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    strokeWidth={2}
                                                    d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                                                />
                                            </svg>
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                                            {t.editor.material}
                                        </div>
                                        <div className="font-bold text-gray-700 leading-tight">
                                            {selectedMaterial.name}
                                        </div>
                                        <div className="text-xs text-blue-400 mt-1">
                                            {selectedMaterial.refCode}
                                        </div>
                                    </div>
                                </div>
                                {/* Smart View */}
                        <button
                            onClick={() => setShowSmartView(true)}
                            className="w-full py-2.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold text-sm hover:from-blue-500 hover:to-indigo-500 transition-colors mt-2 flex items-center justify-center gap-2"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                            {lang === 'es' ? 'Vista Inteligente' : 'Smart View'}
                        </button>

                        {/* New Analysis Trigger */}
                                <Button
                                    variant="ghost"
                                    onClick={handleRoomAnalysis}
                                    disabled={generationState.isAnalyzing}
                                    className="w-full text-[10px] uppercase tracking-widest border border-dashed border-gray-300 hover:border-blue-500 hover:text-blue-400 py-2 mt-2"
                                >
                                    {generationState.isAnalyzing
                                        ? "Analyzing..."
                                        : "AI Room Analysis"}
                                </Button>
                            </div>
                        )}

                        {/* Lighting Toggle */}
                        <div>
                            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3 block">
                                {t.editor.lighting}
                            </label>
                            <div className="flex gap-2">
                                {["NATURAL", "SUNSET", "NIGHT_LUXURY"].map(
                                    (l) => (
                                        <button
                                            key={l}
                                            onClick={() =>
                                                setRenderOptions({
                                                    ...renderOptions,
                                                    lighting: l as any,
                                                })
                                            }
                                            className={`flex-1 p-2 rounded-lg text-[10px] font-bold border transition-all ${renderOptions.lighting === l ? "bg-gray-300 border-gray-400 text-gray-700" : "bg-gray-200 border-gray-300 text-gray-500"}`}
                                        >
                                            {l.replace("_", " ")}
                                        </button>
                                    ),
                                )}
                            </div>
                        </div>

                        {/* Prompt */}
                        <div>
                            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3 block">
                                {t.editor.instructions}
                            </label>
                            <textarea
                                className="w-full bg-gray-200 border border-gray-300 rounded-xl p-3 text-sm text-gray-700 focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none"
                                rows={3}
                                placeholder={
                                    lang === "es"
                                        ? "Ej: Añadir plantas, estilo moderno..."
                                        : "Ex: Add plants, make it modern..."
                                }
                                value={customPrompt}
                                onChange={(e) =>
                                    setCustomPrompt(e.target.value)
                                }
                            />
                            <div className="flex flex-wrap gap-2 mt-2">
                                {t.templates
                                    .slice(0, 3)
                                    .map((template: string, i: number) => (
                                        <button
                                            key={i}
                                            onClick={() =>
                                                setCustomPrompt(template)
                                            }
                                            className="text-[10px] bg-gray-200 text-gray-500 px-2 py-1 rounded-full hover:bg-gray-300 border border-gray-300 text-left"
                                        >
                                            {template}
                                        </button>
                                    ))}
                            </div>
                        </div>
                    </div>

                    <div className="p-6 bg-white border-t border-gray-300 space-y-3">
                        {generationState.error && (
                            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm text-center">
                                {generationState.error}
                            </div>
                        )}
                        <Button
                            onClick={handleGenerate}
                            isLoading={generationState.isGenerating}
                            className="w-full py-4 text-sm uppercase tracking-widest font-black shadow-xl shadow-blue-900/20"
                        >
                            {generationState.resultImage
                                ? t.editor.regenerate
                                : t.editor.generate}
                        </Button>

                        {generationState.resultImage && (
                            <div className="grid grid-cols-1 gap-3">
                                <Button
                                    onClick={handleDownloadResult}
                                    variant="secondary"
                                    className="bg-blue-600 border-blue-500 hover:bg-blue-500 text-gray-700 text-xs uppercase"
                                >
                                    {t.editor.download}
                                </Button>
                                <Button
                                    onClick={() => setView(AppView.ESTIMATION)}
                                    variant="secondary"
                                    className="bg-green-600 border-green-500 hover:bg-green-500 text-gray-700 text-xs uppercase"
                                >
                                    {t.editor.createQuote}
                                </Button>
                            </div>
                        )}
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
                                        src={item.material.imageUrl}
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
                                You will be redirected to your email client to
                                send this order request to our sales team.
                            </p>
                            <div className="bg-slate-100 p-4 rounded text-xs font-mono mb-6 whitespace-pre-wrap">
                                {checkoutBody}
                            </div>
                            <div className="flex gap-3">
                                <Button
                                    variant="secondary"
                                    onClick={() => setShowCheckoutModal(false)}
                                    className="flex-1 border-gray-300 text-gray-600 hover:bg-gray-200"
                                >
                                    {t.common.cancel}
                                </Button>
                                <Button
                                    onClick={() => {
                                        window.open(
                                            `mailto:comercial.buildinginnovation@gmail.com?subject=New Order Request&body=${encodeURIComponent(checkoutBody)}`,
                                        );
                                        setShowCheckoutModal(false);
                                    }}
                                    className="flex-1"
                                >
                                    {t.cart.openGmail}
                                </Button>
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
                                src={selectedMaterial.imageUrl}
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

    const renderSubscriptionModal = () => {
        const tier = currentUser?.tier || 'Free';
        const used = currentUser?.generations_used || 0;
        const limit = tier === 'Free' ? 5 : tier === 'Pro' ? 50 : 9999;
        const remaining = Math.max(0, limit - used);

        return (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-fadeIn">
                <div className="bg-white rounded-3xl max-w-4xl w-full overflow-hidden shadow-2xl flex flex-col md:flex-row h-full max-h-[80vh]">
                    <div className="flex-1 p-8 bg-gray-50 overflow-y-auto">
                        <div className="flex justify-between items-start mb-8">
                            <div>
                                <h2 className="text-3xl font-black text-gray-700 uppercase tracking-tighter">Your Plan</h2>
                                <p className="text-gray-500">Manage your subscription and credits</p>
                            </div>
                            <button onClick={() => setShowSubscriptionModal(false)} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                            {[
                                { name: 'Free', price: '$0', limit: 5, color: 'gray' },
                                { name: 'Pro', price: '$29', limit: 50, color: 'blue', featured: true },
                                { name: 'Enterprise', price: '$99', limit: '∞', color: 'purple' },
                            ].map((p) => (
                                <div key={p.name} className={`relative p-6 rounded-2xl border-2 transition-all ${p.name === tier ? 'border-blue-500 bg-blue-50/50' : 'border-gray-200 bg-white'} ${p.featured ? 'scale-105 shadow-xl z-10 border-blue-400' : ''}`}>
                                    {p.featured && <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-500 text-white text-[10px] px-3 py-1 rounded-full font-bold uppercase tracking-widest">Most Popular</div>}
                                    <div className="text-xl font-black text-gray-700 mb-1">{p.name}</div>
                                    <div className="text-3xl font-black text-blue-600 mb-4">{p.price}<span className="text-xs text-gray-400 font-normal">/mo</span></div>
                                    <ul className="space-y-2 mb-6">
                                        <li className="text-xs text-gray-500 flex items-center gap-2">
                                            <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20"><path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" /></svg>
                                            {p.limit} AI Generations
                                        </li>
                                        <li className="text-xs text-gray-500 flex items-center gap-2">
                                            <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20"><path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" /></svg>
                                            High-Fidelity Export
                                        </li>
                                    </ul>
                                    <button 
                                        disabled={p.name === tier}
                                        onClick={() => handleSelectPlan(p.name)}
                                        className={`w-full py-2 rounded-xl font-bold text-sm transition-all ${p.name === tier ? 'bg-gray-100 text-gray-400 cursor-default' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-900/20 active:scale-95'}`}
                                    >
                                        {p.name === tier ? 'Current Plan' : 'Select Plan'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="w-full md:w-80 bg-white border-l border-gray-200 p-8 flex flex-col">
                        <h3 className="font-bold text-gray-700 uppercase text-xs tracking-widest mb-6">Usage Summary</h3>
                        <div className="flex-1">
                            <div className="mb-6">
                                <div className="flex justify-between text-xs font-bold mb-2">
                                    <span className="text-gray-500">GENERATIONS</span>
                                    <span className="text-gray-700">{used} / {limit === 9999 ? '∞' : limit}</span>
                                </div>
                                <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                                    <div 
                                        className="bg-blue-500 h-full transition-all duration-1000" 
                                        style={{ width: `${Math.min(100, (used / limit) * 100)}%` }}
                                    ></div>
                                </div>
                            </div>

                            <div className="p-4 rounded-2xl bg-blue-50 border border-blue-100">
                                <div className="text-[10px] font-bold text-blue-500 mb-1 uppercase">Remaining</div>
                                <div className="text-4xl font-black text-blue-600">{limit === 9999 ? '∞' : remaining}</div>
                                <div className="text-[10px] text-blue-400">Renders available this month</div>
                            </div>
                        </div>

                        <div className="mt-auto pt-6 border-t border-gray-100">
                            <p className="text-[10px] text-gray-400 leading-relaxed">
                                Generations reset on the 1st of every month. Unused credits do not roll over.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-slate-900 text-gray-700 font-sans selection:bg-blue-500 selection:text-gray-700">
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

            {/* Smart View Overlay */}
            {showSmartView && selectedMaterial && originalImage && (
                <SmartView
                    material={selectedMaterial}
                    capturedImage={originalImage}
                    onClose={() => setShowSmartView(false)}
                    onApply={(resultImage) => {
                        setGenerationState((prev) => ({
                            ...prev,
                            resultImage: resultImage,
                        }));
                        setShowSmartView(false);
                    }}
                    lang={lang}
                />
            )}

            {view === AppView.ESTIMATION && (
                selectedMaterial ? (
                    <div className="h-screen bg-slate-900 p-4 md:p-8 overflow-y-auto flex justify-center">
                        <div className="w-full max-w-4xl h-full">
                            <EstimationPanel
                                material={selectedMaterial}
                                onBack={() => setView(AppView.EDITOR)}
                                onAddToCart={() => {
                                    updateCartCount();
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
            {renderProbeModal()}
        </div>
    );
};

export default App;
