import React, { useState, useEffect } from "react";
import {
    AppView,
    Material,
    GenerationState,
    Contractor,
    CartItem,
    Language,
    RenderOptions,
} from "./types";
import {
    CONTRACTORS as INITIAL_CONTRACTORS,
    TRANSLATIONS,
} from "./constants";
import { Button } from "./components/Button";
import { CameraCapture } from "./components/CameraCapture";
import { ImageComparator } from "./components/ImageComparator";
import { EstimationPanel } from "./components/EstimationPanel";
import {
    generateMaterialOverlay,
    generateRoomAnalysis,
    generateCinematicVideo,
    generateMaterialProbe,
} from "./services/geminiService";

interface HistoryItem {
    resultImage: string | null;
    resultVideo: string | null;
    analysis: string | null;
    prompt: string;
    material: Material | null;
}

// Custom Logo Component
const LOGO_URL =
    "https://res.cloudinary.com/dsex1a9tu/image/upload/v1765472298/LOGO_Building_zp4k50.png";

const BrandLogo = ({ className = "w-10 h-10" }: { className?: string }) => (
    <img
        src={LOGO_URL}
        alt="Building Innovation Logo"
        className={`${className} object-contain`}
    />
);

const App: React.FC = () => {
    const [view, setView] = useState<AppView>(AppView.LOGIN);
    const [categoryUsage, setCategoryUsage] = useState<
        "Interior" | "Exterior" | "All"
    >("Interior");
    const [lang, setLang] = useState<Language>("en");

    // Dynamic Data State
    const [materials, setMaterials] = useState<Material[]>([]);
    const [contractors, setContractors] = useState<Contractor[]>([]);
    const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(
        null,
    );

    // Search State
    const [searchQuery, setSearchQuery] = useState("");

    // Admin Form State
    const [adminTab, setAdminTab] = useState<
        "MATERIALS" | "CONTRACTORS" | "SETTINGS"
    >("MATERIALS");
    const [isEditing, setIsEditing] = useState(false);
    const [editForm, setEditForm] = useState<Partial<Material>>({});
    const [contractorForm, setContractorForm] = useState<Partial<Contractor>>(
        {},
    );
    const [customApiKey, setCustomApiKey] = useState("");

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
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);

    const [showCheckoutModal, setShowCheckoutModal] = useState(false);
    const [checkoutBody, setCheckoutBody] = useState("");

    const t = TRANSLATIONS[lang];

    const loadMaterialsFromDB = async () => {
        try {
            const res = await fetch("/api/materials");
            const dbMaterials = await res.json();
            if (dbMaterials && dbMaterials.length > 0) {
                const converted = dbMaterials.map((m: any) => ({
                    id: String(m.id),
                    refCode: m.ref_code || "",
                    name: m.name || "",
                    category: m.category || "General",
                    subcategory: m.subcategory || "",
                    description: m.description || "",
                    imageUrl: m.image_url || "",
                    usage: m.usage || "Interior",
                    promptModifier: m.prompt_modifier || "",
                    dimensions: {
                        width: parseFloat(m.width_cm) || 100,
                        length: parseFloat(m.length_cm) || 100,
                        thickness: parseFloat(m.thickness_m) || 5,
                    },
                    pricing: {
                        pricePerUnit: parseFloat(m.price) || 0,
                        currency: "USD",
                        unitLabel: m.unit || "Piece",
                        itemsPerBox: m.items_per_box || 1,
                    },
                }));
                setMaterials(converted);
            } else {
                setMaterials([]);
            }
        } catch (e) {
            console.error("Failed to load materials from DB:", e);
            setMaterials([]);
        }
    };

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

        const savedKey = localStorage.getItem("custom_api_key");
        if (savedKey) setCustomApiKey(savedKey);
        updateCartCount();
    }, []);

    useEffect(() => {
        if (contractors.length > 0)
            localStorage.setItem(
                "constructVizContractors",
                JSON.stringify(contractors),
            );
    }, [contractors]);

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

    const handleSaveMaterial = async () => {
        if (!editForm.name || !editForm.refCode) return;

        const dbMaterial = {
            ref_code: editForm.refCode,
            name: editForm.name,
            category: editForm.category || "General",
            subcategory: editForm.subcategory || "",
            price: editForm.pricing?.pricePerUnit || 0,
            unit: editForm.pricing?.unitLabel || "Piece",
            items_per_box: editForm.pricing?.itemsPerBox || 1,
            width_cm: editForm.dimensions?.width || 100,
            length_cm: editForm.dimensions?.length || 100,
            thickness_m: editForm.dimensions?.thickness || 5,
            description: editForm.description || "",
            image_url: editForm.imageUrl || "",
            usage: editForm.usage || "Interior",
            prompt_modifier: editForm.promptModifier || "",
        };

        try {
            if (isEditing && editForm.id) {
                await fetch(`/api/materials/${editForm.id}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(dbMaterial),
                });
            } else {
                await fetch("/api/materials", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(dbMaterial),
                });
            }
            loadMaterialsFromDB();
        } catch (e) {
            console.error("Failed to save material:", e);
        }

        setEditForm({});
        setIsEditing(false);
    };

    const handleDeleteMaterial = async (id: string) => {
        if (confirm("Delete material?")) {
            try {
                await fetch(`/api/materials/${id}`, { method: "DELETE" });
                loadMaterialsFromDB();
            } catch (e) {
                console.error("Failed to delete:", e);
            }
        }
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
            `"${m.name.replace(/"/g, '""')}"`,
            m.category,
            m.subcategory || "",
            m.pricing.pricePerUnit,
            m.pricing.unitLabel,
            m.pricing.itemsPerBox || 1,
            m.dimensions.width,
            m.dimensions.length,
            m.dimensions.thickness,
            `"${m.description.replace(/"/g, '""')}"`,
            `"${m.imageUrl}"`,
            m.usage,
            `"${m.promptModifier.replace(/"/g, '""')}"`,
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

    const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
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

                // Skip header (row 0), start at 1
                for (let i = 1; i < data.length; i++) {
                    const cols = data[i];
                    if (cols.length < 4) continue;

                    // Cleaning logic
                    const clean = (s: string) => (s ? s.trim() : "");
                    const usage = clean(cols[13]);
                    const validUsage =
                        usage === "Exterior" ? usage : "Interior";

                    const newMat: Material = {
                        id: cols[0] ? clean(cols[0]) : `csv-${Date.now()}-${i}`,
                        refCode: clean(cols[1]) || `REF-${i}`,
                        name: clean(cols[2]) || "Imported Material",
                        category: clean(cols[3]) || "General",
                        subcategory: clean(cols[4]) || "",
                        pricing: {
                            pricePerUnit: parseFloat(cols[5]) || 0,
                            currency: "USD",
                            unitLabel: clean(cols[6]) || "Unit",
                            itemsPerBox: parseFloat(cols[7]) || 1,
                        },
                        dimensions: {
                            width: parseFloat(cols[8]) || 100,
                            length: parseFloat(cols[9]) || 100,
                            thickness: parseFloat(cols[10]) || 5,
                        },
                        description: clean(cols[11]) || "",
                        imageUrl: clean(cols[12]) || "",
                        usage: validUsage as "Interior" | "Exterior",
                        promptModifier:
                            clean(cols[14]) ||
                            `${clean(cols[2])}, ${clean(cols[3])} ${clean(cols[4])}`,
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

    const handleSaveApiKey = () => {
        localStorage.setItem("custom_api_key", customApiKey.trim());
        alert("API Key Saved!");
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

        // Reset probe state and start loading
        setGenerationState((prev) => ({
            ...prev,
            isGenerating: true,
            error: null,
            materialProbe: null,
        }));

        try {
            const probeImage = await generateMaterialProbe(material);
            setGenerationState((prev) => ({
                ...prev,
                isGenerating: false,
                materialProbe: probeImage,
            }));
        } catch (error: any) {
            setGenerationState((prev) => ({
                ...prev,
                isGenerating: false,
                error: error.message,
            }));
        }
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
        if (!originalImage || !selectedMaterial) return;
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
        } catch (error: any) {
            setGenerationState((prev) => ({
                ...prev,
                isGenerating: false,
                error: error.message || "Failed.",
            }));
        }
    };

    const handleGenerateProbe = async () => {
        if (!selectedMaterial) return;
        setShowProbeModal(true);
        setGenerationState((prev) => ({
            ...prev,
            isGenerating: true,
            error: null,
            materialProbe: null,
        }));
        try {
            const probeImage = await generateMaterialProbe(selectedMaterial);
            setGenerationState((prev) => ({
                ...prev,
                isGenerating: false,
                materialProbe: probeImage,
            }));
        } catch (error: any) {
            setGenerationState((prev) => ({
                ...prev,
                isGenerating: false,
                error: error.message,
            }));
        }
    };

    const handleRoomAnalysis = async () => {
        if (!originalImage) return;
        setGenerationState((prev) => ({
            ...prev,
            isAnalyzing: true,
            error: null,
        })); // Use isAnalyzing instead of isGenerating
        try {
            const analysisText = await generateRoomAnalysis(originalImage);
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
        <div className="flex bg-slate-800 rounded-lg p-1 border border-slate-700">
            <button
                onClick={() => setLang("en")}
                className={`px-3 py-1 text-xs font-bold rounded transition-colors ${lang === "en" ? "bg-blue-600 text-white shadow" : "text-slate-400 hover:text-white"}`}
            >
                EN
            </button>
            <button
                onClick={() => setLang("es")}
                className={`px-3 py-1 text-xs font-bold rounded transition-colors ${lang === "es" ? "bg-blue-600 text-white shadow" : "text-slate-400 hover:text-white"}`}
            >
                ES
            </button>
        </div>
    );

    const renderLogin = () => (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 relative overflow-hidden bg-slate-900">
            <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=2000&q=80')] bg-cover bg-center opacity-20"></div>
            <div className="relative z-10 w-full max-w-md bg-slate-800/50 backdrop-blur-xl border border-slate-700 p-8 rounded-2xl shadow-2xl">
                <div className="flex flex-col items-center mb-8">
                    <BrandLogo className="w-20 h-20 mb-4" />
                    <h1 className="text-3xl font-black text-white tracking-tight">
                        BUILDING{" "}
                        <span className="text-blue-500">INNOVATION</span>
                    </h1>
                </div>
                <form
                    className="space-y-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        setView(AppView.LANDING);
                    }}
                >
                    <input
                        type="email"
                        className="w-full bg-slate-900/50 border border-slate-700 rounded-lg p-3 text-white"
                        placeholder={t.login.email}
                    />
                    <input
                        type="password"
                        className="w-full bg-slate-900/50 border border-slate-700 rounded-lg p-3 text-white"
                        placeholder={t.login.password}
                    />
                    <Button
                        className="w-full py-4 text-base font-bold shadow-lg"
                        onClick={() => setView(AppView.LANDING)}
                    >
                        {t.login.signIn}
                    </Button>

                    <div className="relative flex py-2 items-center">
                        <div className="flex-grow border-t border-slate-700"></div>
                        <span className="flex-shrink-0 mx-4 text-slate-500 text-xs font-bold uppercase">
                            Or
                        </span>
                        <div className="flex-grow border-t border-slate-700"></div>
                    </div>

                    <Button
                        type="button"
                        variant="ghost"
                        className="w-full py-3 text-slate-400 hover:text-white hover:bg-slate-800/50"
                        onClick={() => setView(AppView.LANDING)}
                    >
                        {t.login.skip} →
                    </Button>
                </form>
            </div>
        </div>
    );

    const renderLanding = () => (
        <div className="min-h-screen bg-slate-900 p-6 flex flex-col">
            <header className="flex justify-between items-center mb-8 md:mb-12">
                <div className="flex items-center gap-3">
                    <BrandLogo className="w-10 h-10" />
                    <div className="hidden md:block">
                        <h1 className="text-lg font-black text-white leading-none">
                            BUILDING
                        </h1>
                        <div className="text-[10px] text-blue-500 font-bold tracking-[0.2em]">
                            INNOVATION
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <LanguageToggle />
                    <button
                        onClick={() => setView(AppView.CART)}
                        className="relative p-2 text-slate-400 hover:text-white"
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
                            <span className="absolute top-0 right-0 w-4 h-4 bg-blue-500 rounded-full text-[10px] font-bold text-white flex items-center justify-center">
                                {cartCount}
                            </span>
                        )}
                    </button>
                    <button
                        onClick={() => setView(AppView.ADMIN)}
                        className="p-2 text-slate-400 hover:text-white"
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
                </div>
            </header>

            <div className="flex-1 flex flex-col justify-center max-w-4xl mx-auto w-full">
                <h2 className="text-5xl md:text-7xl font-black text-white mb-2 tracking-tighter">
                    {t.landing.title}{" "}
                    <span className="text-blue-500">{t.landing.materials}</span>
                </h2>
                <p className="text-slate-400 text-lg md:text-xl max-w-xl mb-12">
                    {t.landing.subtitle}
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <button
                        onClick={() => handleStart("Interior")}
                        className="group relative h-48 rounded-2xl overflow-hidden border border-slate-700 hover:border-blue-500 transition-all"
                    >
                        <img
                            src="https://res.cloudinary.com/dsex1a9tu/image/upload/v1765473265/Interior_zl8aus.png"
                            className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover:opacity-80 transition-opacity"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 to-transparent flex flex-col justify-end p-6">
                            <span className="text-blue-400 font-bold uppercase tracking-wider text-xs mb-1">
                                {t.landing.interiorsDesc}
                            </span>
                            <span className="text-2xl font-black text-white">
                                {t.landing.interiors}
                            </span>
                        </div>
                    </button>
                    <button
                        onClick={() => handleStart("Exterior")}
                        className="group relative h-48 rounded-2xl overflow-hidden border border-slate-700 hover:border-blue-500 transition-all"
                    >
                        <img
                            src="https://res.cloudinary.com/dsex1a9tu/image/upload/v1765473265/Exterior_znoarm.jpg"
                            className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover:opacity-80 transition-opacity"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 to-transparent flex flex-col justify-end p-6">
                            <span className="text-green-400 font-bold uppercase tracking-wider text-xs mb-1">
                                {t.landing.exteriorDesc}
                            </span>
                            <span className="text-2xl font-black text-white">
                                {t.landing.exterior}
                            </span>
                        </div>
                    </button>
                </div>
            </div>
        </div>
    );

    const renderAdmin = () => (
        <div className="min-h-screen bg-slate-900 text-slate-100 p-6 overflow-auto">
            <div className="max-w-7xl mx-auto">
                <div className="flex justify-between items-center mb-8">
                    <div className="flex items-center gap-3">
                        <Button
                            variant="ghost"
                            onClick={() => setView(AppView.LANDING)}
                        >
                            ← {t.common.back}
                        </Button>
                        <h1 className="text-2xl font-black text-white uppercase">
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
                        {/* Toolbar */}
                        <div className="flex flex-col md:flex-row justify-between gap-4 bg-slate-800 p-4 rounded-xl border border-slate-700">
                            <div className="flex gap-2">
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
                                        onChange={handleCSVUpload}
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
                                        {t.admin.importCSV}
                                    </Button>
                                </div>
                            </div>
                            <div className="flex gap-2">
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
                                <Button
                                    onClick={resetMaterials}
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
                                    {t.admin.resetDB}
                                </Button>
                            </div>
                        </div>

                        {/* Add/Edit Form */}
                        {(isEditing || editForm.usage) && (
                            <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-xl">
                                <h3 className="text-lg font-bold text-white mb-4">
                                    {isEditing
                                        ? t.admin.editProduct
                                        : t.admin.newProduct}
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                                    {/* Row 1: Identifiers */}
                                    <div>
                                        <label className="block text-xs uppercase text-slate-500 mb-1">
                                            {t.admin.refCode}
                                        </label>
                                        <input
                                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
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
                                        <label className="block text-xs uppercase text-slate-500 mb-1">
                                            {t.admin.productName}
                                        </label>
                                        <input
                                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
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
                                        <label className="block text-xs uppercase text-slate-500 mb-1">
                                            {t.admin.category}
                                        </label>
                                        <input
                                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
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
                                        <label className="block text-xs uppercase text-slate-500 mb-1">
                                            {t.admin.subcategory}
                                        </label>
                                        <input
                                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
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
                                        <label className="block text-xs uppercase text-slate-500 mb-1">
                                            {t.admin.width}
                                        </label>
                                        <input
                                            type="number"
                                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
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
                                        <label className="block text-xs uppercase text-slate-500 mb-1">
                                            {t.admin.length}
                                        </label>
                                        <input
                                            type="number"
                                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
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
                                        <label className="block text-xs uppercase text-slate-500 mb-1">
                                            {t.admin.thickness}
                                        </label>
                                        <input
                                            type="number"
                                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
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
                                        <label className="block text-xs uppercase text-slate-500 mb-1">
                                            {t.admin.price}
                                        </label>
                                        <input
                                            type="number"
                                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
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
                                                        currency: "USD",
                                                    },
                                                })
                                            }
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs uppercase text-slate-500 mb-1">
                                            {t.admin.unitLabel}
                                        </label>
                                        <input
                                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
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
                                        <label className="block text-xs uppercase text-slate-500 mb-1">
                                            {t.admin.itemsPerBox}
                                        </label>
                                        <input
                                            type="number"
                                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
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

                                    <div>
                                        <label className="block text-xs uppercase text-slate-500 mb-1">
                                            {t.admin.imageSource}
                                        </label>
                                        <div className="flex gap-2">
                                            <input
                                                type="file"
                                                onChange={handleFileUpload}
                                                className="text-xs text-slate-400"
                                            />
                                            {editForm.imageUrl && (
                                                <img
                                                    src={editForm.imageUrl}
                                                    className="w-8 h-8 rounded border border-slate-600"
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
                        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                            <table className="w-full text-left text-sm text-slate-400">
                                <thead className="bg-slate-900 text-slate-200 uppercase text-xs font-bold">
                                    <tr>
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
                                            {t.admin.tableDimensions}
                                        </th>
                                        <th className="p-4">
                                            {t.admin.tablePackaging}
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
                                    {materials.map((m) => (
                                        <tr
                                            key={m.id}
                                            className="hover:bg-slate-700/50 transition-colors"
                                        >
                                            <td className="p-4">
                                                <img
                                                    src={m.imageUrl}
                                                    alt={m.name}
                                                    className="w-12 h-12 rounded object-cover border border-slate-600 bg-slate-900"
                                                />
                                            </td>
                                            <td className="p-4 font-mono text-blue-400">
                                                {m.refCode}
                                            </td>
                                            <td className="p-4 font-medium text-white">
                                                {m.name}
                                                <div className="text-xs text-slate-500">
                                                    {m.category}
                                                </div>
                                            </td>
                                            <td className="p-4">
                                                <div className="text-white">
                                                    {m.dimensions.width} x{" "}
                                                    {m.dimensions.length} cm
                                                </div>
                                                <div className="text-xs text-slate-500">
                                                    {m.dimensions.thickness} mm
                                                </div>
                                            </td>
                                            <td className="p-4">
                                                {m.pricing.itemsPerBox &&
                                                m.pricing.itemsPerBox > 1 ? (
                                                    <span className="text-green-400">
                                                        {m.pricing.itemsPerBox}{" "}
                                                        items/box
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-500">
                                                        Single Unit
                                                    </span>
                                                )}
                                            </td>
                                            <td className="p-4 text-white">
                                                ${m.pricing.pricePerUnit} /{" "}
                                                {m.pricing.unitLabel}
                                            </td>
                                            <td className="p-4 text-right space-x-2">
                                                <button
                                                    onClick={() => {
                                                        setEditForm(m);
                                                        setIsEditing(true);
                                                    }}
                                                    className="text-blue-400 hover:text-white px-2 py-1 hover:bg-slate-600 rounded"
                                                >
                                                    {t.admin.edit}
                                                </button>
                                                <button
                                                    onClick={() =>
                                                        handleDeleteMaterial(
                                                            m.id,
                                                        )
                                                    }
                                                    className="text-red-400 hover:text-white px-2 py-1 hover:bg-red-900/50 rounded"
                                                >
                                                    {t.admin.delete}
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {materials.length === 0 && (
                                <div className="p-8 text-center text-slate-500">
                                    {t.admin.noProducts}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {adminTab === "CONTRACTORS" && (
                    <div className="space-y-6">
                        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                            <h3 className="text-lg font-bold text-white mb-4">
                                Add Installer
                            </h3>
                            <div className="flex gap-4 mb-4">
                                <input
                                    className="bg-slate-900 border border-slate-700 rounded p-2 text-white flex-1"
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
                                    className="bg-slate-900 border border-slate-700 rounded p-2 text-white flex-1"
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
                                    className="bg-slate-800 p-4 rounded-xl border border-slate-700"
                                >
                                    <div className="font-bold text-white">
                                        {c.name}
                                    </div>
                                    <div className="text-sm text-blue-400">
                                        {c.region}
                                    </div>
                                    <div className="text-xs text-slate-500 mt-2">
                                        {c.email}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {adminTab === "SETTINGS" && (
                    <div className="max-w-xl">
                        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                            <h3 className="text-lg font-bold text-white mb-4">
                                API Configuration
                            </h3>
                            <p className="text-sm text-slate-400 mb-4">
                                Enter your Google GenAI API Key to enable Image
                                and Video generation.
                            </p>
                            <input
                                type="password"
                                className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white mb-4"
                                placeholder="AIzaSy..."
                                value={customApiKey}
                                onChange={(e) =>
                                    setCustomApiKey(e.target.value)
                                }
                            />
                            <Button onClick={handleSaveApiKey}>Save Key</Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );

    const renderGallery = () => {
        const filtered = materials.filter(
            (m) =>
                (categoryUsage === "All" || m.usage === categoryUsage) &&
                (m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    m.category
                        .toLowerCase()
                        .includes(searchQuery.toLowerCase())),
        );

        return (
            <div className="min-h-screen bg-slate-900 flex flex-col">
                <header className="bg-slate-900/80 backdrop-blur-md sticky top-0 z-20 border-b border-slate-800 p-4">
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
                            <h2 className="text-xl font-bold text-white uppercase tracking-wider">
                                {t.gallery.collection}
                            </h2>
                        </div>
                        <div className="flex gap-4">
                            <LanguageToggle />
                            <input
                                type="text"
                                placeholder="Search..."
                                className="hidden md:block bg-slate-800 border-none rounded-full px-4 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500"
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
                                className="group relative aspect-square rounded-2xl overflow-hidden bg-slate-800 border border-slate-700 hover:border-blue-500 hover:shadow-2xl hover:shadow-blue-900/20 transition-all text-left"
                            >
                                <img
                                    src={material.imageUrl}
                                    alt={material.name}
                                    className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent p-4 flex flex-col justify-end">
                                    <div className="text-[10px] font-bold text-blue-400 uppercase tracking-wider mb-1">
                                        {material.category}
                                    </div>
                                    <div className="text-white font-bold leading-tight mb-1">
                                        {material.name}
                                    </div>
                                    <div className="text-[10px] text-slate-400">
                                        {material.dimensions.width}x
                                        {material.dimensions.length}cm
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                    {filtered.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-20 text-slate-500">
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
                                        <div className="absolute bottom-4 right-4 z-30 w-48 aspect-video rounded-lg overflow-hidden border-2 border-white shadow-2xl animate-fadeIn">
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
                                    className="w-full h-full object-contain shadow-2xl"
                                />
                            )}
                        </div>

                        {/* AI Analysis Overlay */}
                        {(generationState.analysis ||
                            generationState.isAnalyzing) && (
                            <div className="absolute bottom-8 left-8 right-8 z-40 bg-slate-900/90 backdrop-blur border border-slate-700 p-4 rounded-xl text-xs text-slate-300 max-h-48 overflow-y-auto animate-fadeIn shadow-2xl max-w-2xl mx-auto">
                                <div className="flex items-center gap-2 mb-2 sticky top-0 bg-slate-900/90 pb-2 border-b border-slate-800">
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
                                        AI Analysis
                                    </span>
                                </div>
                                {generationState.isAnalyzing ? (
                                    <div className="space-y-2 py-1">
                                        <div className="h-1.5 bg-slate-700 rounded w-full animate-pulse"></div>
                                        <div className="h-1.5 bg-slate-700 rounded w-2/3 animate-pulse"></div>
                                        <div className="h-1.5 bg-slate-700 rounded w-5/6 animate-pulse"></div>
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
                <div className="w-full md:w-96 bg-slate-900 border-l border-slate-800 flex flex-col h-[40vh] md:h-full z-20 shadow-2xl">
                    <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                        <Button
                            variant="ghost"
                            onClick={() => setView(AppView.CAMERA)}
                            className="text-xs uppercase tracking-wider"
                        >
                            {t.editor.back}
                        </Button>
                        <LanguageToggle />
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 space-y-8">
                        {/* Material Info */}
                        {selectedMaterial && (
                            <div className="flex flex-col gap-2 bg-slate-800 p-4 rounded-xl border border-slate-700">
                                <div className="flex items-center gap-4">
                                    <div
                                        className="relative group cursor-pointer"
                                        onClick={handleGenerateProbe}
                                    >
                                        <img
                                            src={selectedMaterial.imageUrl}
                                            className="w-16 h-16 rounded-lg object-cover border border-slate-600"
                                        />
                                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg">
                                            <svg
                                                className="w-6 h-6 text-white"
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
                                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                                            {t.editor.material}
                                        </div>
                                        <div className="font-bold text-white leading-tight">
                                            {selectedMaterial.name}
                                        </div>
                                        <div className="text-xs text-blue-400 mt-1">
                                            {selectedMaterial.refCode}
                                        </div>
                                    </div>
                                </div>
                                {/* New Analysis Trigger */}
                                <Button
                                    variant="ghost"
                                    onClick={handleRoomAnalysis}
                                    disabled={generationState.isAnalyzing}
                                    className="w-full text-[10px] uppercase tracking-widest border border-dashed border-slate-600 hover:border-blue-500 hover:text-blue-400 py-2 mt-2"
                                >
                                    {generationState.isAnalyzing
                                        ? "Analyzing..."
                                        : "AI Room Analysis"}
                                </Button>
                            </div>
                        )}

                        {/* View Mode Toggle */}
                        <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 block">
                                {t.editor.viewMode}
                            </label>
                            <div className="flex flex-col gap-2">
                                <button
                                    onClick={() =>
                                        setRenderOptions({
                                            ...renderOptions,
                                            viewAngle: "PERSPECTIVE",
                                        })
                                    }
                                    className={`p-3 rounded-lg text-xs font-bold border transition-all text-left ${renderOptions.viewAngle === "PERSPECTIVE" ? "bg-blue-600 border-blue-500 text-white" : "bg-slate-800 border-slate-700 text-slate-400"}`}
                                >
                                    {t.editor.perspective}
                                </button>
                                <button
                                    onClick={() =>
                                        setRenderOptions({
                                            ...renderOptions,
                                            viewAngle: "TOP_DOWN",
                                        })
                                    }
                                    className={`p-3 rounded-lg text-xs font-bold border transition-all text-left ${renderOptions.viewAngle === "TOP_DOWN" ? "bg-blue-600 border-blue-500 text-white" : "bg-slate-800 border-slate-700 text-slate-400"}`}
                                >
                                    {t.editor.topDown}
                                </button>
                                <button
                                    onClick={() =>
                                        setRenderOptions({
                                            ...renderOptions,
                                            viewAngle: "ISOMETRIC",
                                        })
                                    }
                                    className={`p-3 rounded-lg text-xs font-bold border transition-all text-left ${renderOptions.viewAngle === "ISOMETRIC" ? "bg-blue-600 border-blue-500 text-white" : "bg-slate-800 border-slate-700 text-slate-400"}`}
                                >
                                    {t.editor.isometric}
                                </button>
                            </div>
                        </div>

                        {/* Lighting Toggle */}
                        <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 block">
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
                                            className={`flex-1 p-2 rounded-lg text-[10px] font-bold border transition-all ${renderOptions.lighting === l ? "bg-slate-700 border-slate-500 text-white" : "bg-slate-800 border-slate-800 text-slate-500"}`}
                                        >
                                            {l.replace("_", " ")}
                                        </button>
                                    ),
                                )}
                            </div>
                        </div>

                        {/* Prompt */}
                        <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 block">
                                {t.editor.instructions}
                            </label>
                            <textarea
                                className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-sm text-white focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none"
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
                                            className="text-[10px] bg-slate-800 text-slate-400 px-2 py-1 rounded-full hover:bg-slate-700 border border-slate-700 text-left"
                                        >
                                            {template}
                                        </button>
                                    ))}
                            </div>
                        </div>
                    </div>

                    <div className="p-6 bg-slate-900 border-t border-slate-800 space-y-3">
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
                            <div className="grid grid-cols-2 gap-3">
                                <Button
                                    onClick={handleAnimateVideo}
                                    variant="secondary"
                                    className="text-xs uppercase"
                                    disabled={generationState.isGenerating}
                                >
                                    Video Pan (Veo)
                                </Button>
                                <Button
                                    onClick={() => setView(AppView.ESTIMATION)}
                                    variant="secondary"
                                    className="bg-green-600 border-green-500 hover:bg-green-500 text-white text-xs uppercase"
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
            <div className="min-h-screen bg-slate-900 flex flex-col p-6">
                <header className="flex justify-between items-center mb-8">
                    <Button
                        variant="ghost"
                        onClick={() => setView(AppView.LANDING)}
                    >
                        ← {t.common.back}
                    </Button>
                    <h1 className="text-2xl font-black text-white">
                        {t.cart.title}
                    </h1>
                </header>

                <div className="flex-1 max-w-4xl mx-auto w-full">
                    {cartItems.length === 0 ? (
                        <div className="text-center py-20">
                            <div className="text-slate-500 mb-4">
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
                                    className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex gap-4 items-center"
                                >
                                    <img
                                        src={item.material.imageUrl}
                                        className="w-16 h-16 rounded object-cover"
                                    />
                                    <div className="flex-1">
                                        <div className="font-bold text-white">
                                            {item.material.name}
                                        </div>
                                        <div className="text-sm text-slate-400">
                                            {item.quantity}{" "}
                                            {item.material.pricing.unitLabel} •{" "}
                                            {item.dimensions.width}x
                                            {item.dimensions.height}m
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="font-bold text-green-400">
                                            ${item.totalCost.toFixed(2)}
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

                            <div className="mt-8 bg-slate-950 p-6 rounded-xl border border-slate-800 flex justify-between items-center">
                                <span className="text-slate-400 uppercase tracking-widest font-bold">
                                    {t.cart.total}
                                </span>
                                <span className="text-3xl font-black text-white">
                                    ${total.toFixed(2)}
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
                                                    `- ${i.material.name}: ${i.quantity} units ($${i.totalCost})`,
                                            )
                                            .join("\n");
                                        setCheckoutBody(
                                            `${lang === "es" ? "Orden de Compra" : "Order Request"}:\n\n${body}\n\nTotal: $${total}`,
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
                            <p className="text-sm text-slate-600 mb-6">
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
                                    className="flex-1 border-slate-300 text-slate-600 hover:bg-slate-200"
                                >
                                    {t.common.cancel}
                                </Button>
                                <Button
                                    onClick={() => {
                                        window.open(
                                            `mailto:sales@buildinginnovation.com?subject=New Order Request&body=${encodeURIComponent(checkoutBody)}`,
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
                    className="relative max-w-lg w-full bg-slate-900 rounded-2xl overflow-hidden shadow-2xl border border-slate-700 flex flex-col max-h-[90vh]"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="absolute top-4 right-4 z-10">
                        <button
                            onClick={() => setShowProbeModal(false)}
                            className="bg-black/50 text-white rounded-full p-2 hover:bg-white hover:text-black transition-colors"
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

                    <div className="flex-1 bg-black flex items-center justify-center min-h-[300px] relative">
                        {generationState.isGenerating ? (
                            <div className="flex flex-col items-center">
                                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mb-4"></div>
                                <p className="text-blue-400 text-xs font-mono animate-pulse">
                                    Generating 3D Sample...
                                </p>
                            </div>
                        ) : generationState.materialProbe ? (
                            <img
                                src={generationState.materialProbe}
                                className="w-full h-full object-contain"
                            />
                        ) : (
                            <div className="text-red-400 text-sm p-4 text-center">
                                {generationState.error ||
                                    "Failed to generate preview."}
                            </div>
                        )}
                    </div>

                    <div className="p-6 bg-slate-900 space-y-6">
                        <div className="text-center">
                            <div className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mb-1">
                                {selectedMaterial?.category}
                            </div>
                            <h3 className="text-2xl font-black text-white mb-2">
                                {selectedMaterial?.name}
                            </h3>
                            <p className="text-slate-400 text-sm line-clamp-2">
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

    return (
        <div className="min-h-screen bg-slate-900 text-slate-50 font-sans selection:bg-blue-500 selection:text-white">
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
                            className="text-white"
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
            {view === AppView.ESTIMATION && selectedMaterial && (
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
                        />
                    </div>
                </div>
            )}
            {view === AppView.CART && renderCart()}
            {renderProbeModal()}
        </div>
    );
};

export default App;
