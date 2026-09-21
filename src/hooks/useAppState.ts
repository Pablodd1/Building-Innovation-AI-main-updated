import { useState, useEffect, useCallback, useMemo } from 'react';
import {
    AppView, Material, GenerationState, Contractor, Language, RenderOptions, User
} from '../types';
import { CONTRACTORS as INITIAL_CONTRACTORS, TRANSLATIONS, MATERIALS } from '../constants';
import { formatMetersUSA } from '../services/unitUtils';

export interface HistoryItem {
    resultImage: string | null;
    resultVideo: string | null;
    analysis: import('../types').RoomAnalysisResult | null;
    prompt: string;
    material: Material | null;
}

export const useAppState = () => {
    const [view, setView] = useState<AppView>(AppView.LOGIN);
    const [categoryUsage, setCategoryUsage] = useState<'Interior' | 'Exterior' | 'All'>('Interior');
    const [lang, setLang] = useState<Language>('en');
    const [unitSystem, setUnitSystem] = useState<'latam' | 'usa'>('usa');

    // Auth
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [showMockCheckout, setShowMockCheckout] = useState(false);
    const [checkoutTier, setCheckoutTier] = useState<string | null>(null);
    const [selectedUserDetail, setSelectedUserDetail] = useState<any>(null);
    const [showUserDetailModal, setShowUserDetailModal] = useState(false);
    const [isLoadingUserDetail, setIsLoadingUserDetail] = useState(false);
    const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
    const [authForm, setAuthForm] = useState({ name: '', email: '', email_phone: '', address: '', password: '' });
    const [authError, setAuthError] = useState('');
    const [authLoading, setAuthLoading] = useState(false);

    // Data
    const [materials, setMaterials] = useState<Material[]>([]);
    const [materialsLoading, setMaterialsLoading] = useState(true);
    const [contractors, setContractors] = useState<Contractor[]>(INITIAL_CONTRACTORS);
    const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(null);
    const [estimationSource, setEstimationSource] = useState<AppView>(AppView.GALLERY);
    const [displayCurrency, setDisplayCurrency] = useState<'USD' | 'COP'>('USD');
    const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    // Admin
    const [adminTab, setAdminTab] = useState<any>('MATERIALS');
    const [allUsers, setAllUsers] = useState<User[]>([]);
    const [isLoadingUsers, setIsLoadingUsers] = useState(false);
    const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);
    const [tiersConfig, setTiersConfig] = useState<any>(null);
    const [editableTiers, setEditableTiers] = useState<any>(null);
    const [isSavingTiers, setIsSavingTiers] = useState(false);
    const [secureConfig, setSecureConfig] = useState<any>(null);
    const [isSavingConfig, setIsSavingConfig] = useState(false);
    const [configForm, setConfigForm] = useState({ apiKey: '', stripeSecretKey: '', stripeWebhookSecret: '' });
    const [analyticsData, setAnalyticsData] = useState<any>(null);
    const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(false);
    const [auditLogs, setAuditLogs] = useState<any[]>([]);
    const [isLoadingAuditLogs, setIsLoadingAuditLogs] = useState(false);
    const [auditSearchQuery, setAuditSearchQuery] = useState('');
    const [auditActionFilter, setAuditActionFilter] = useState('ALL');
    const [newAdminForm, setNewAdminForm] = useState({ name: '', email: '', password: '' });
    const [isCreatingAdmin, setIsCreatingAdmin] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editForm, setEditForm] = useState<Partial<Material>>({});
    const [contractorForm, setContractorForm] = useState<Partial<Contractor>>({});
    const [currentPage, setCurrentPage] = useState(1);
    const [adminCollectionFilter, setAdminCollectionFilter] = useState<'All' | 'Interior' | 'Exterior'>('All');

    // Generation
    const [renderOptions, setRenderOptions] = useState<RenderOptions>({ lighting: 'NATURAL', viewAngle: 'PERSPECTIVE', declutter: false });
    const [editorTab, setEditorTab] = useState<'CONFIGURE' | 'ANALYZE'>('CONFIGURE');
    const [generationState, setGenerationState] = useState<GenerationState>({
        isGenerating: false, isAnalyzing: false, error: null,
        resultImage: null, resultVideo: null, analysis: null, materialProbe: null,
    });
    const [originalImage, setOriginalImage] = useState<string | null>(null);
    const [customPrompt, setCustomPrompt] = useState('');
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [showProbeModal, setShowProbeModal] = useState(false);

    // Cart
    const [cartCount, setCartCount] = useState(0);
    const [showCheckoutModal, setShowCheckoutModal] = useState(false);
    const [checkoutBody, setCheckoutBody] = useState('');
    const [selectedMaterialIds, setSelectedMaterialIds] = useState<Set<string>>(new Set());
    const [toast, setToast] = useState<string | null>(null);

    const USD_TO_COP_RATE = 4100;
    const itemsPerPage = 10;

    // Effects
    useEffect(() => { setUnitSystem(lang === 'es' ? 'latam' : 'usa'); }, [lang]);

    useEffect(() => {
        const originalFetch = window.fetch;
        window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            let finalInput = input;
            let apiBase = (import.meta as any).env?.VITE_API_BASE_URL || '';
            if (!apiBase) {
                const isNativeMobile =
                    Boolean((window as any).Capacitor?.isNativePlatform?.()) ||
                    window.location.protocol === 'capacitor:' ||
                    (window.location.hostname === 'localhost' && window.location.port !== '5173' && window.location.port !== '3000');
                if (isNativeMobile) {
                    apiBase = 'https://buildingapp.us';
                }
            }
            if (typeof input === 'string') {
                if (input.startsWith('/api/') && apiBase) {
                    finalInput = `${apiBase}${input}`;
                }
            } else if (input instanceof URL) {
                if (input.pathname.startsWith('/api/') && apiBase) {
                    finalInput = new URL(input.pathname + input.search, apiBase).href;
                }
            }
            const stored = localStorage.getItem('constructviz_user');
            let token = '';
            if (stored) {
                try { const parsed = JSON.parse(stored); if (parsed?.session_token) token = parsed.session_token; } catch {}
            }
            if (token) {
                init = init || {};
                init.headers = init.headers || {};
                if (init.headers instanceof Headers) {
                    init.headers.set('Authorization', `Bearer ${token}`);
                } else if (Array.isArray(init.headers)) {
                    const hasAuth = init.headers.some((h: any) => h[0].toLowerCase() === 'authorization');
                    if (!hasAuth) init.headers.push(['Authorization', `Bearer ${token}`]);
                } else {
                    if (!init.headers['Authorization'] && !init.headers['authorization']) {
                        init.headers['Authorization'] = `Bearer ${token}`;
                    }
                }
            }
            return originalFetch(finalInput, init);
        };
        try {
            const saved = localStorage.getItem('constructviz_user');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed?.id) { setCurrentUser(parsed); setView(AppView.LANDING); }
            }
        } catch (e) {}
        return () => { window.fetch = originalFetch; };
    }, []);

    useEffect(() => {
        if (currentUser) localStorage.setItem('constructviz_user', JSON.stringify(currentUser));
        else localStorage.removeItem('constructviz_user');
    }, [currentUser]);

    useEffect(() => {
        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(
                (pos) => setUserLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
                (err) => console.warn('Location access denied:', err.message)
            );
        }
    }, []);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const sessionId = params.get('session_id');
        if (sessionId) {
            const stored = localStorage.getItem('constructviz_user');
            if (stored) {
                try {
                    const parsed = JSON.parse(stored);
                    if (parsed?.id) {
                        fetch(`/api/users/${parsed.id}`)
                            .then(r => r.json())
                            .then(u => { if (u?.tier) setCurrentUser(prev => prev ? { ...prev, ...u } : u); })
                            .catch(err => console.warn('Failed to refresh user tier', err));
                    }
                } catch {}
            }
            alert(lang === 'es' ? 'Pago exitoso! Tu cuenta ha sido actualizada.' : 'Payment successful! Your account has been updated.');
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }, [lang]);

    const formatPrice = useCallback((pricePerUnit: number, materialCurrency: string, targetCurrency: 'USD' | 'COP' | 'EUR'): string => {
        let convertedPrice = pricePerUnit;
        const EUR_TO_USD_RATE = 1.1;
        if (materialCurrency === 'USD' && targetCurrency === 'COP') convertedPrice = Math.round(pricePerUnit * USD_TO_COP_RATE);
        else if (materialCurrency === 'USD' && targetCurrency === 'EUR') convertedPrice = pricePerUnit / EUR_TO_USD_RATE;
        else if (materialCurrency === 'COP' && targetCurrency === 'EUR') convertedPrice = (pricePerUnit / USD_TO_COP_RATE) / EUR_TO_USD_RATE;
        else if ((materialCurrency === 'COP' || materialCurrency === 'MXN') && targetCurrency === 'USD') convertedPrice = Math.round((pricePerUnit / USD_TO_COP_RATE) * 100) / 100;
        else if ((materialCurrency === 'COP' || materialCurrency === 'MXN') && targetCurrency === 'COP') convertedPrice = Math.round(pricePerUnit);
        else if (materialCurrency === 'EUR' && targetCurrency === 'USD') convertedPrice = Math.round(pricePerUnit * EUR_TO_USD_RATE * 100) / 100;
        else if (materialCurrency === 'EUR' && targetCurrency === 'COP') convertedPrice = Math.round(pricePerUnit * EUR_TO_USD_RATE * USD_TO_COP_RATE);
        else if (targetCurrency === 'USD') convertedPrice = Math.round(pricePerUnit * 100) / 100;
        else if (targetCurrency === 'COP') convertedPrice = Math.round(pricePerUnit);
        else convertedPrice = Math.round(pricePerUnit * 100) / 100;

        if (targetCurrency === 'USD') return `$${convertedPrice.toFixed(2)}`;
        if (targetCurrency === 'EUR') return `\u20ac${convertedPrice.toFixed(2)}`;
        return `$${convertedPrice.toLocaleString('es-CO')} COP`;
    }, [USD_TO_COP_RATE]);

    const getTierLimit = useCallback((tierName: string) => {
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
    }, [tiersConfig]);

    const getCol = useCallback((key: string) => {
        const t = TRANSLATIONS[lang] || TRANSLATIONS.en;
        return t[key] || key;
    }, [lang]);

    return {
        view, setView, categoryUsage, setCategoryUsage, lang, setLang, unitSystem, setUnitSystem,
        currentUser, setCurrentUser, showMockCheckout, setShowMockCheckout, checkoutTier, setCheckoutTier,
        selectedUserDetail, setSelectedUserDetail, showUserDetailModal, setShowUserDetailModal,
        isLoadingUserDetail, setIsLoadingUserDetail, authMode, setAuthMode, authForm, setAuthForm,
        authError, setAuthError, authLoading, setAuthLoading, materials, setMaterials,
        materialsLoading, setMaterialsLoading, contractors, setContractors, selectedMaterial, setSelectedMaterial,
        estimationSource, setEstimationSource, displayCurrency, setDisplayCurrency,
        userLocation, setUserLocation, searchQuery, setSearchQuery, allUsers, setAllUsers,
        isLoadingUsers, setIsLoadingUsers, showSubscriptionModal, setShowSubscriptionModal,
        tiersConfig, setTiersConfig, editableTiers, setEditableTiers, isSavingTiers, setIsSavingTiers,
        secureConfig, setSecureConfig, isSavingConfig, setIsSavingConfig, configForm, setConfigForm,
        adminTab, setAdminTab, analyticsData, setAnalyticsData, isLoadingAnalytics, setIsLoadingAnalytics,
        auditLogs, setAuditLogs, isLoadingAuditLogs, setIsLoadingAuditLogs, auditSearchQuery, setAuditSearchQuery,
        auditActionFilter, setAuditActionFilter, newAdminForm, setNewAdminForm, isCreatingAdmin, setIsCreatingAdmin,
        isEditing, setIsEditing, editForm, setEditForm, contractorForm, setContractorForm,
        renderOptions, setRenderOptions, editorTab, setEditorTab, generationState, setGenerationState,
        originalImage, setOriginalImage, customPrompt, setCustomPrompt, history, setHistory,
        historyIndex, setHistoryIndex, showProbeModal, setShowProbeModal, cartCount, setCartCount,
        showCheckoutModal, setShowCheckoutModal, checkoutBody, setCheckoutBody,
        selectedMaterialIds, setSelectedMaterialIds, currentPage, setCurrentPage,
        adminCollectionFilter, setAdminCollectionFilter, toast, setToast,
        USD_TO_COP_RATE, itemsPerPage, TRANSLATIONS, CONTRACTORS: INITIAL_CONTRACTORS, MATERIALS,
        formatPrice, getTierLimit, getCol, formatMetersUSA, AppView,
    };
};
