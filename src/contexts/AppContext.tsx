import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
    AppView, Material, GenerationState, Contractor, Language, RenderOptions, User
} from '../types';
import { CONTRACTORS as INITIAL_CONTRACTORS, TRANSLATIONS, MATERIALS } from '../constants';
import { formatMetersUSA } from '../services/unitUtils';

interface HistoryItem {
    resultImage: string | null;
    resultVideo: string | null;
    analysis: import('../types').RoomAnalysisResult | null;
    prompt: string;
    material: Material | null;
}

export interface AppContextValue {
    // Navigation
    view: AppView;
    setView: (v: AppView) => void;

    // Language / Units
    lang: Language;
    setLang: (l: Language) => void;
    unitSystem: 'latam' | 'usa';
    setUnitSystem: (u: 'latam' | 'usa') => void;

    // User
    currentUser: User | null;
    setCurrentUser: (u: User | null) => void;
    authMode: 'login' | 'signup';
    setAuthMode: (m: 'login' | 'signup') => void;
    authForm: any;
    setAuthForm: any;
    authError: string;
    setAuthError: (e: string) => void;
    authLoading: boolean;
    setAuthLoading: (l: boolean) => void;

    // Materials
    materials: Material[];
    setMaterials: any;
    materialsLoading: boolean;
    setMaterialsLoading: (l: boolean) => void;
    selectedMaterial: Material | null;
    setSelectedMaterial: (m: Material | null) => void;
    selectedMaterialIds: Set<string>;
    setSelectedMaterialIds: any;
    categoryUsage: 'Interior' | 'Exterior' | 'All';
    setCategoryUsage: any;
    searchQuery: string;
    setSearchQuery: (q: string) => void;
    displayCurrency: 'USD' | 'COP';
    setDisplayCurrency: any;

    // Contractors
    contractors: Contractor[];
    setContractors: any;

    // Generation
    generationState: GenerationState;
    setGenerationState: any;
    originalImage: string | null;
    setOriginalImage: (img: string | null) => void;
    customPrompt: string;
    setCustomPrompt: (p: string) => void;
    renderOptions: RenderOptions;
    setRenderOptions: any;
    editorTab: 'CONFIGURE' | 'ANALYZE';
    setEditorTab: any;
    history: HistoryItem[];
    setHistory: any;
    historyIndex: number;
    setHistoryIndex: (i: number) => void;
    showProbeModal: boolean;
    setShowProbeModal: (s: boolean) => void;

    // Cart / Checkout
    cartCount: number;
    setCartCount: (n: number) => void;
    showCheckoutModal: boolean;
    setShowCheckoutModal: any;
    checkoutBody: string;
    setCheckoutBody: any;
    showMockCheckout: boolean;
    setShowMockCheckout: any;
    checkoutTier: string | null;
    setCheckoutTier: any;
    estimationSource: AppView;
    setEstimationSource: any;

    // Admin
    adminTab: any;
    setAdminTab: any;
    allUsers: User[];
    setAllUsers: any;
    isLoadingUsers: boolean;
    setIsLoadingUsers: any;
    selectedUserDetail: any;
    setSelectedUserDetail: any;
    showUserDetailModal: boolean;
    setShowUserDetailModal: any;
    isLoadingUserDetail: boolean;
    setIsLoadingUserDetail: any;
    tiersConfig: any;
    setTiersConfig: any;
    editableTiers: any;
    setEditableTiers: any;
    isSavingTiers: boolean;
    setIsSavingTiers: any;
    secureConfig: any;
    setSecureConfig: any;
    isSavingConfig: boolean;
    setIsSavingConfig: any;
    configForm: any;
    setConfigForm: any;
    analyticsData: any;
    setAnalyticsData: any;
    isLoadingAnalytics: boolean;
    setIsLoadingAnalytics: any;
    auditLogs: any[];
    setAuditLogs: any;
    isLoadingAuditLogs: boolean;
    setIsLoadingAuditLogs: any;
    auditSearchQuery: string;
    setAuditSearchQuery: any;
    auditActionFilter: string;
    setAuditActionFilter: any;
    newAdminForm: any;
    setNewAdminForm: any;
    isCreatingAdmin: boolean;
    setIsCreatingAdmin: any;
    isEditing: boolean;
    setIsEditing: any;
    editForm: Partial<Material>;
    setEditForm: any;
    contractorForm: Partial<Contractor>;
    setContractorForm: any;
    showSubscriptionModal: boolean;
    setShowSubscriptionModal: any;
    currentPage: number;
    setCurrentPage: any;
    adminCollectionFilter: 'All' | 'Interior' | 'Exterior';
    setAdminCollectionFilter: any;

    // UI
    toast: string | null;
    setToast: (t: string | null) => void;
    userLocation: { lat: number; lon: number } | null;
    setUserLocation: any;

    // Constants & helpers
    USD_TO_COP_RATE: number;
    itemsPerPage: number;
    formatPrice: (price: number, currency: string, target: 'USD' | 'COP' | 'EUR') => string;
    getTierLimit: (tierName: string) => number;
    getCol: (key: string) => string;
    TRANSLATIONS: any;
    CONTRACTORS: any;
    MATERIALS: any;

    // Handlers
    handleAuth: (e: React.FormEvent) => Promise<void>;
    handleLogout: () => void;
    handleSaveMaterial: () => Promise<void>;
    handleDeleteMaterial: (id: string) => Promise<void>;
    handleBulkDelete: () => Promise<void>;
    handleFileUpload: (file: File) => void;
    handleSaveContractor: () => void;
    handleGenerate: () => Promise<void>;
    handleGenerateProbe: () => Promise<void>;
    handleRoomAnalysis: () => Promise<void>;
    handleAnimateVideo: () => Promise<void>;
    handleSelectMaterial: (m: Material) => void;
    handleImageCapture: (img: string) => void;
    handleStart: (img: string) => void;
    handleDownloadResult: () => void;
    handleSaveTiers: () => Promise<void>;
    fetchAnalytics: () => Promise<void>;
    fetchAllUsers: () => Promise<void>;
    fetchAuditLogs: () => Promise<void>;
    fetchSecureConfig: () => Promise<void>;
    handleSaveSecureConfig: () => Promise<void>;
    handleCreateAdmin: () => Promise<void>;
    loadMaterialsFromDB: () => Promise<void>;
    updateCartCount: () => void;
    handleDownloadCSV: () => void;
    resetMaterials: () => Promise<void>;
    handleCSVUploadForCollection: (file: File) => void;
    handleUpdateUserTier: (userId: number, tier: string) => Promise<void>;
    handleUpdateUserGenerations: (userId: number, generations: number) => Promise<void>;
    handleSelectPlan: (tier: string) => void;
    handleUpdateTierField: (tierKey: string, field: string, value: any) => void;
    handleImageError: (id: string) => void;
    handleSaveConfig: () => void;
    fetchTiers: () => Promise<void>;
    loadUserMemory: (userId: number) => Promise<void>;
    handleStartEditor: (material: Material) => void;
    handleBack: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export const useApp = () => {
    const ctx = useContext(AppContext);
    if (!ctx) throw new Error('useApp must be used within AppProvider');
    return ctx;
};

export const AppProvider: React.FC<{ children: React.ReactNode; value: AppContextValue }> = ({ children, value }) => (
    <AppContext.Provider value={value}>{children}</AppContext.Provider>
);
