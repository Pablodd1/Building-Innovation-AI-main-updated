
import React, { useState, useEffect } from 'react';
import { AppView, Material, GenerationState, Contractor, CartItem, Language } from './types';
import { MATERIALS as INITIAL_MATERIALS, CONTRACTORS as INITIAL_CONTRACTORS, TRANSLATIONS } from './constants';
import { Button } from './components/Button';
import { CameraCapture } from './components/CameraCapture';
import { ImageComparator } from './components/ImageComparator';
import { EstimationPanel } from './components/EstimationPanel';
import { generateMaterialOverlay, generateRoomAnalysis, generateCinematicVideo } from './services/geminiService';

interface HistoryItem {
  resultImage: string | null;
  resultVideo: string | null;
  analysis: string | null;
  prompt: string;
  material: Material | null;
}

const QUICK_TEMPLATES = [
  "Remove construction debris and tools",
  "Add warm evening lighting",
  "Remove furniture to show empty room",
  "Enhance natural sunlight",
  "Apply a modern industrial style",
  "Make it look like a luxury hotel lobby"
];

// Custom Logo Component
const BrandLogo = ({ className = "stroke-white" }: { className?: string }) => (
  <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M10 20L20 15L30 20" className={className} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M10 26L20 21L30 26" className={className} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M10 32L20 27L30 32" className={className} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M5 10L20 2L35 10" className={className} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const App: React.FC = () => {
  const [view, setView] = useState<AppView>(AppView.LOGIN);
  const [categoryUsage, setCategoryUsage] = useState<'Interior' | 'Exterior' | 'Furniture' | 'All'>('Interior');
  const [lang, setLang] = useState<Language>('en');
  
  // Dynamic Data State
  const [materials, setMaterials] = useState<Material[]>([]);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(null);
  
  // Search State
  const [searchQuery, setSearchQuery] = useState('');

  // Admin Form State
  const [adminTab, setAdminTab] = useState<'MATERIALS' | 'CONTRACTORS' | 'SETTINGS'>('MATERIALS');
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Material>>({});
  const [contractorForm, setContractorForm] = useState<Partial<Contractor>>({});
  const [customApiKey, setCustomApiKey] = useState('');

  // Login State
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState<string>('');
  
  const [editorTab, setEditorTab] = useState<'CONFIGURE' | 'ANALYZE'>('CONFIGURE');

  const [generationState, setGenerationState] = useState<GenerationState>({
    isGenerating: false,
    error: null,
    resultImage: null,
    resultVideo: null,
    analysis: null
  });
  const [cartCount, setCartCount] = useState<number>(0);

  // Checkout Modal State
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [checkoutBody, setCheckoutBody] = useState('');

  // History Management
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Translations Helper
  const t = TRANSLATIONS[lang];

  // Load Data from LocalStorage on mount
  useEffect(() => {
    // Materials
    const savedMaterials = localStorage.getItem('constructVizMaterials');
    if (savedMaterials) {
      try {
        setMaterials(JSON.parse(savedMaterials));
      } catch (e) {
        setMaterials(INITIAL_MATERIALS);
      }
    } else {
      setMaterials(INITIAL_MATERIALS);
    }

    // Contractors
    const savedContractors = localStorage.getItem('constructVizContractors');
    if (savedContractors) {
        try {
            setContractors(JSON.parse(savedContractors));
        } catch (e) {
            setContractors(INITIAL_CONTRACTORS);
        }
    } else {
        setContractors(INITIAL_CONTRACTORS);
    }

    // API Key - Load from database and sync to localStorage
    fetch('/api/settings/custom_api_key')
      .then(res => res.json())
      .then(data => {
        if (data.value) {
          setCustomApiKey(data.value);
          localStorage.setItem('custom_api_key', data.value);
        }
      })
      .catch(err => console.error('Failed to load API key:', err));

  }, []);

  // Save Data to LocalStorage whenever changes
  useEffect(() => {
    if (materials.length > 0) localStorage.setItem('constructVizMaterials', JSON.stringify(materials));
  }, [materials]);

  useEffect(() => {
    if (contractors.length > 0) localStorage.setItem('constructVizContractors', JSON.stringify(contractors));
  }, [contractors]);

  const updateCartCount = () => {
    try {
        const existingCartJson = localStorage.getItem('constructVizCart');
        const cart = existingCartJson ? JSON.parse(existingCartJson) : [];
        setCartCount(cart.length);
    } catch(e) {}
  };

  useEffect(() => {
    updateCartCount();
  }, []);

  // --- File Helper ---
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, field: 'thumbnailUrl' | 'exampleImageUrl') => {
    if (e.target.files && e.target.files[0]) {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onloadend = () => {
            setEditForm(prev => ({ ...prev, [field]: reader.result as string }));
        };
        reader.readAsDataURL(file);
    }
  };

  // --- Admin Functions ---

  const handleSaveMaterial = () => {
    if (!editForm.name || !editForm.refCode) return;

    if (isEditing && editForm.id) {
        const updated = materials.map(m => m.id === editForm.id ? { ...m, ...editForm } as Material : m);
        setMaterials(updated);
    } else {
        const newMaterial: Material = {
            ...INITIAL_MATERIALS[0],
            ...editForm as Material,
            id: `mat-${Date.now()}`,
            pricing: { ...INITIAL_MATERIALS[0].pricing, ...editForm.pricing },
            dimensions: { ...INITIAL_MATERIALS[0].dimensions, ...editForm.dimensions }
        };
        setMaterials([...materials, newMaterial]);
    }
    setEditForm({});
    setIsEditing(false);
  };

  const handleDeleteMaterial = (id: string) => {
    if (confirm('Are you sure you want to delete this material?')) {
        setMaterials(materials.filter(m => m.id !== id));
    }
  };

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
          const file = e.target.files[0];
          const reader = new FileReader();
          reader.onload = (event) => {
              const text = event.target?.result as string;
              const lines = text.split('\n');
              const newMats: Material[] = [];
              
              for(let i=1; i<lines.length; i++) {
                  const cols = lines[i].split(',');
                  if(cols.length < 4) continue;
                  
                  const newMat: Material = {
                      ...INITIAL_MATERIALS[0],
                      id: `csv-${Date.now()}-${i}`,
                      name: cols[0]?.trim() || 'Imported Material',
                      refCode: cols[1]?.trim() || '0000',
                      category: cols[2]?.trim() || 'General',
                      pricing: { ...INITIAL_MATERIALS[0].pricing, pricePerUnit: parseFloat(cols[3]) || 0 },
                      usage: 'Interior'
                  };
                  newMats.push(newMat);
              }
              
              if(newMats.length > 0) {
                  setMaterials([...materials, ...newMats]);
                  alert(`Imported ${newMats.length} materials.`);
              }
          };
          reader.readAsText(file);
      }
  };

  const handleSaveContractor = () => {
      if (!contractorForm.name) return;
      const newContractor: Contractor = {
          id: `cont-${Date.now()}`,
          name: contractorForm.name || '',
          email: contractorForm.email || '',
          phone: contractorForm.phone || '',
          region: contractorForm.region || ''
      };
      setContractors([...contractors, newContractor]);
      setContractorForm({});
  };

  const handleDeleteContractor = (id: string) => {
      setContractors(contractors.filter(c => c.id !== id));
  };
  
  const handleSaveApiKey = async () => {
      try {
        await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'custom_api_key', value: customApiKey.trim() })
        });
        localStorage.setItem('custom_api_key', customApiKey.trim());
        alert("API Key Saved! The app will now use your custom key for Pro features.");
      } catch (error) {
        alert("Failed to save API Key. Please try again.");
      }
  };
  
  const handleClearApiKey = async () => {
      try {
        await fetch('/api/settings/custom_api_key', { method: 'DELETE' });
        localStorage.removeItem('custom_api_key');
        setCustomApiKey('');
        alert("Custom API Key removed. Reverting to default.");
      } catch (error) {
        alert("Failed to remove API Key. Please try again.");
      }
  }

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    
    if (loginEmail === 'admin' && loginPassword === 'admin@@@') {
      setView(AppView.LANDING);
      setLoginEmail('');
      setLoginPassword('');
    } else {
      setLoginError('Invalid credentials. Please try again.');
    }
  };

  const resetMaterials = () => {
    if(confirm('This will delete all custom data. Are you sure?')) {
        setMaterials(INITIAL_MATERIALS);
        setContractors(INITIAL_CONTRACTORS);
        localStorage.removeItem('constructVizMaterials');
        localStorage.removeItem('constructVizContractors');
    }
  };

  // --- Main Logic ---

  const handleStart = (usage: 'Interior' | 'Exterior' | 'Furniture' | 'All') => {
    setCategoryUsage(usage);
    setView(AppView.GALLERY);
  };

  const handleSelectMaterial = (material: Material) => {
    setSelectedMaterial(material);
    setView(AppView.CAMERA);
  };

  const handleImageCapture = (file: File) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      setOriginalImage(reader.result as string);
      setView(AppView.EDITOR);
      // Reset history for new image
      setHistory([]);
      setHistoryIndex(-1);
      setGenerationState(prev => ({...prev, resultImage: null, resultVideo: null, analysis: null, error: null}));
    };
    reader.readAsDataURL(file);
  };

  const handleGenerate = async () => {
    if (!originalImage || !selectedMaterial) return;

    setGenerationState(prev => ({ ...prev, isGenerating: true, error: null }));

    try {
      const generatedImage = await generateMaterialOverlay(
        originalImage,
        selectedMaterial,
        customPrompt
      );

      // Update History
      const newHistoryItem: HistoryItem = {
          resultImage: generatedImage,
          resultVideo: null,
          analysis: null,
          prompt: customPrompt,
          material: selectedMaterial // Store the material used for this gen
      };

      const newHistory = [...history.slice(0, historyIndex + 1), newHistoryItem];
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);

      setGenerationState(prev => ({
        ...prev,
        isGenerating: false,
        resultImage: generatedImage
      }));
    } catch (error: any) {
      const errMsg = error.message || "Failed to generate image.";
      setGenerationState(prev => ({ ...prev, isGenerating: false, error: errMsg }));
    }
  };

  const handleRoomAnalysis = async () => {
      if (!originalImage) return;
      setGenerationState(prev => ({ ...prev, isGenerating: true }));
      try {
          const analysisText = await generateRoomAnalysis(originalImage);
          // Update current history item or create new one? 
          // Better to just update state for now as it's auxiliary
          setGenerationState(prev => ({ ...prev, isGenerating: false, analysis: analysisText }));
      } catch (e: any) {
          setGenerationState(prev => ({ ...prev, isGenerating: false, error: "Analysis failed." }));
      }
  };

  const handleAnimateVideo = async () => {
      // Use the LATEST generated image (resultImage) or original if none
      const sourceImage = generationState.resultImage || originalImage;
      if (!sourceImage) return;

      setGenerationState(prev => ({ ...prev, isGenerating: true }));
      try {
          // Use material name as context for the video prompt
          const contextPrompt = selectedMaterial ? `featuring ${selectedMaterial.name}` : 'architectural tour';
          const videoUri = await generateCinematicVideo(sourceImage, contextPrompt);
          
          if (!videoUri) {
             alert("Veo Video Generation is currently not available for your API Key tier. Please add a paid API Key in Admin > Settings.");
             setGenerationState(prev => ({ ...prev, isGenerating: false }));
             return;
          }

          // Add to history? Or just state?
          // Let's attach to current history item if exists
          if (historyIndex >= 0) {
              const updatedHistory = [...history];
              updatedHistory[historyIndex].resultVideo = videoUri;
              setHistory(updatedHistory);
          }

          setGenerationState(prev => ({ ...prev, isGenerating: false, resultVideo: videoUri }));
      } catch (e: any) {
          setGenerationState(prev => ({ ...prev, isGenerating: false, error: "Video generation failed." }));
      }
  };

  // --- Views ---

  const renderLogin = () => (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 relative overflow-hidden bg-slate-900">
      <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=2000&q=80')] bg-cover bg-center opacity-20"></div>
      <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/80 to-transparent"></div>
      
      <div className="relative z-10 w-full max-w-md bg-slate-800/50 backdrop-blur-xl border border-slate-700 p-8 rounded-2xl shadow-2xl animate-fadeIn">
        <div className="flex flex-col items-center mb-8">
            <BrandLogo className="stroke-blue-500 mb-4 w-16 h-16" />
            <h1 className="text-3xl font-black text-white tracking-tight text-center">BUILDING <span className="text-blue-500">INNOVATION</span></h1>
            <p className="text-slate-400 text-sm mt-2 font-medium tracking-wide">AI-POWERED ARCHITECTURAL VISUALIZATION</p>
        </div>

        <form className="space-y-4" onSubmit={handleLogin}>
            {loginError && (
              <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-2 rounded-lg text-sm">
                {loginError}
              </div>
            )}
            <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">{t.login.email}</label>
                <input type="text" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} className="w-full bg-slate-900/50 border border-slate-700 rounded-lg p-3 text-white mt-1 focus:ring-2 focus:ring-blue-500 outline-none transition-all" placeholder="admin" />
            </div>
            <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">{t.login.password}</label>
                <input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} className="w-full bg-slate-900/50 border border-slate-700 rounded-lg p-3 text-white mt-1 focus:ring-2 focus:ring-blue-500 outline-none transition-all" placeholder="••••••••" />
            </div>
            <Button type="submit" className="w-full py-4 text-base font-bold shadow-blue-500/20 shadow-lg">
                {t.login.signIn}
            </Button>
            <div className="pt-4 text-center">
                 <button type="button" onClick={() => setView(AppView.LANDING)} className="text-slate-500 hover:text-white text-sm font-medium transition-colors">
                    {t.login.skip} &rarr;
                 </button>
            </div>
        </form>
      </div>
      <div className="absolute bottom-6 flex space-x-4">
          <button onClick={() => setLang('en')} className={`text-xs font-bold uppercase tracking-widest ${lang === 'en' ? 'text-blue-500' : 'text-slate-600'}`}>English</button>
          <div className="w-px h-4 bg-slate-700"></div>
          <button onClick={() => setLang('es')} className={`text-xs font-bold uppercase tracking-widest ${lang === 'es' ? 'text-blue-500' : 'text-slate-600'}`}>Español</button>
      </div>
    </div>
  );

  const renderLanding = () => (
    <div className="min-h-screen bg-slate-900 p-6 flex flex-col">
       <header className="flex justify-between items-center mb-8 md:mb-12">
           <div className="flex items-center gap-3">
               <BrandLogo className="stroke-white w-8 h-8" />
               <div className="hidden md:block">
                   <h1 className="text-lg font-black text-white leading-none">BUILDING</h1>
                   <div className="text-[10px] text-blue-500 font-bold tracking-[0.2em]">INNOVATION</div>
               </div>
           </div>
           <div className="flex items-center gap-3">
               <button onClick={() => setView(AppView.CART)} className="relative p-2 text-slate-400 hover:text-white transition-colors">
                   <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" /></svg>
                   {cartCount > 0 && <span className="absolute top-0 right-0 w-4 h-4 bg-blue-500 rounded-full text-[10px] font-bold text-white flex items-center justify-center">{cartCount}</span>}
               </button>
               <button onClick={() => setView(AppView.ADMIN)} className="p-2 text-slate-400 hover:text-white transition-colors">
                   <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
               </button>
           </div>
       </header>
       
       <div className="flex-1 flex flex-col justify-center max-w-5xl mx-auto w-full">
           <div className="mb-10 text-center md:text-left">
               <h2 className="text-5xl md:text-7xl font-black text-white tracking-tight mb-2">
                   {t.landing.title} <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-purple-500">{t.landing.materials}</span>
               </h2>
               <p className="text-slate-400 text-lg md:max-w-xl">{t.landing.subtitle}</p>
           </div>

           <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-8">
               {/* Card 1: Interior */}
               <div 
                  onClick={() => handleStart('Interior')}
                  className="group relative h-80 md:h-96 rounded-3xl overflow-hidden cursor-pointer border border-slate-700 hover:border-blue-500 transition-all duration-300"
               >
                   <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80')] bg-cover bg-center transition-transform duration-700 group-hover:scale-110"></div>
                   <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent opacity-80 group-hover:opacity-60 transition-opacity"></div>
                   <div className="absolute bottom-0 left-0 p-8">
                       <h3 className="text-3xl font-bold text-white mb-2 group-hover:translate-x-2 transition-transform">{t.landing.interiors}</h3>
                       <p className="text-slate-300 text-sm font-medium">{t.landing.interiorsDesc}</p>
                   </div>
                   <div className="absolute top-6 right-6 w-10 h-10 bg-white/10 backdrop-blur rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                   </div>
               </div>

               {/* Card 2: Furniture */}
               <div 
                  onClick={() => handleStart('Furniture')}
                  className="group relative h-80 md:h-96 rounded-3xl overflow-hidden cursor-pointer border border-slate-700 hover:border-purple-500 transition-all duration-300"
               >
                   <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1556228453-efd6c1ff04f6?auto=format&fit=crop&w=800&q=80')] bg-cover bg-center transition-transform duration-700 group-hover:scale-110"></div>
                   <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent opacity-80 group-hover:opacity-60 transition-opacity"></div>
                   <div className="absolute bottom-0 left-0 p-8">
                       <h3 className="text-3xl font-bold text-white mb-2 group-hover:translate-x-2 transition-transform">{t.landing.furniture}</h3>
                       <p className="text-slate-300 text-sm font-medium">{t.landing.furnitureDesc}</p>
                   </div>
                   <div className="absolute top-6 right-6 w-10 h-10 bg-white/10 backdrop-blur rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                   </div>
               </div>

               {/* Card 3: Exterior */}
               <div 
                  onClick={() => handleStart('Exterior')}
                  className="group relative h-80 md:h-96 rounded-3xl overflow-hidden cursor-pointer border border-slate-700 hover:border-green-500 transition-all duration-300"
               >
                   <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1599806112354-67f8b5425a06?auto=format&fit=crop&w=800&q=80')] bg-cover bg-center transition-transform duration-700 group-hover:scale-110"></div>
                   <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent opacity-80 group-hover:opacity-60 transition-opacity"></div>
                   <div className="absolute bottom-0 left-0 p-8">
                       <h3 className="text-3xl font-bold text-white mb-2 group-hover:translate-x-2 transition-transform">{t.landing.exterior}</h3>
                       <p className="text-slate-300 text-sm font-medium">{t.landing.exteriorDesc}</p>
                   </div>
                   <div className="absolute top-6 right-6 w-10 h-10 bg-white/10 backdrop-blur rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                   </div>
               </div>
           </div>
       </div>
    </div>
  );

  const renderAdmin = () => (
      <div className="min-h-screen bg-slate-900 text-white p-6 md:p-10">
          <div className="max-w-4xl mx-auto">
              <div className="flex justify-between items-center mb-10">
                  <h1 className="text-3xl font-black">ADMIN CONSOLE</h1>
                  <Button variant="secondary" onClick={() => setView(AppView.LANDING)}>Exit</Button>
              </div>

              <div className="flex space-x-4 mb-8 border-b border-slate-700 pb-1">
                  <button onClick={() => setAdminTab('MATERIALS')} className={`pb-3 px-2 font-bold text-sm uppercase tracking-wider ${adminTab === 'MATERIALS' ? 'text-blue-500 border-b-2 border-blue-500' : 'text-slate-500'}`}>Material Catalog</button>
                  <button onClick={() => setAdminTab('CONTRACTORS')} className={`pb-3 px-2 font-bold text-sm uppercase tracking-wider ${adminTab === 'CONTRACTORS' ? 'text-blue-500 border-b-2 border-blue-500' : 'text-slate-500'}`}>Contractors</button>
                  <button onClick={() => setAdminTab('SETTINGS')} className={`pb-3 px-2 font-bold text-sm uppercase tracking-wider ${adminTab === 'SETTINGS' ? 'text-blue-500 border-b-2 border-blue-500' : 'text-slate-500'}`}>Settings</button>
              </div>

              {adminTab === 'MATERIALS' && (
                  <div className="animate-fadeIn">
                      <div className="bg-slate-800 rounded-xl p-6 mb-8 border border-slate-700">
                          <h3 className="text-lg font-bold mb-4">{isEditing ? 'Edit Material' : 'Add New Material'}</h3>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <input placeholder="Material Name" className="bg-slate-900 border border-slate-600 p-3 rounded" value={editForm.name || ''} onChange={e => setEditForm({...editForm, name: e.target.value})} />
                              <input placeholder="Ref Code" className="bg-slate-900 border border-slate-600 p-3 rounded" value={editForm.refCode || ''} onChange={e => setEditForm({...editForm, refCode: e.target.value})} />
                              <select className="bg-slate-900 border border-slate-600 p-3 rounded" value={editForm.category || ''} onChange={e => setEditForm({...editForm, category: e.target.value})}>
                                  <option value="">Select Category...</option>
                                  <option value="Rollos Adhesivos">Rollos Adhesivos</option>
                                  <option value="Pisos SPC">Pisos SPC</option>
                                  <option value="Zocalos">Zocalos</option>
                                  <option value="Muebles">Muebles (Furniture)</option>
                                  <option value="Pisos Deck">Pisos Deck</option>
                              </select>
                              <div className="flex gap-2">
                                  <input type="file" onChange={(e) => handleFileUpload(e, 'thumbnailUrl')} className="hidden" id="thumb-upload" />
                                  <label htmlFor="thumb-upload" className="flex-1 bg-slate-700 flex items-center justify-center rounded cursor-pointer text-xs font-bold uppercase hover:bg-slate-600">
                                      {editForm.thumbnailUrl ? 'Change Thumb' : 'Upload Thumb'}
                                  </label>
                                  {editForm.thumbnailUrl && <img src={editForm.thumbnailUrl} className="h-10 w-10 rounded object-cover" />}
                              </div>
                              <input placeholder="Price per Unit" type="number" className="bg-slate-900 border border-slate-600 p-3 rounded" value={editForm.pricing?.pricePerUnit || ''} onChange={e => setEditForm({...editForm, pricing: {...(editForm.pricing || {}), pricePerUnit: parseFloat(e.target.value)} as any})} />
                              <textarea placeholder="AI Prompt Modifier" className="bg-slate-900 border border-slate-600 p-3 rounded md:col-span-2" value={editForm.promptModifier || ''} onChange={e => setEditForm({...editForm, promptModifier: e.target.value})} />
                          </div>
                          <div className="flex justify-end gap-3 mt-4">
                              {isEditing && <Button variant="secondary" onClick={() => {setIsEditing(false); setEditForm({});}}>Cancel</Button>}
                              <Button onClick={handleSaveMaterial}>Save Material</Button>
                          </div>
                      </div>

                      <div className="flex justify-between items-center mb-4">
                          <h3 className="font-bold text-slate-400 uppercase tracking-widest text-sm">Existing Materials</h3>
                          <div className="relative">
                              <input type="file" accept=".csv" onChange={handleCSVUpload} className="hidden" id="csv-upload" />
                              <label htmlFor="csv-upload" className="text-blue-500 hover:text-white text-xs font-bold uppercase cursor-pointer">Import CSV</label>
                          </div>
                      </div>

                      <div className="space-y-2">
                          {materials.map(m => (
                              <div key={m.id} className="flex justify-between items-center bg-slate-800/50 p-4 rounded border border-slate-700/50">
                                  <div className="flex items-center gap-3">
                                      <img src={m.thumbnailUrl} className="w-10 h-10 rounded object-cover" />
                                      <div>
                                          <div className="font-bold">{m.name}</div>
                                          <div className="text-xs text-slate-500">{m.category} | {m.refCode}</div>
                                      </div>
                                  </div>
                                  <div className="flex gap-2">
                                      <button onClick={() => {setEditForm(m); setIsEditing(true);}} className="text-blue-500 text-sm font-bold">Edit</button>
                                      <button onClick={() => handleDeleteMaterial(m.id)} className="text-red-500 text-sm font-bold">Delete</button>
                                  </div>
                              </div>
                          ))}
                      </div>
                  </div>
              )}

              {adminTab === 'CONTRACTORS' && (
                   <div className="animate-fadeIn">
                      <div className="bg-slate-800 rounded-xl p-6 mb-8 border border-slate-700">
                          <h3 className="text-lg font-bold mb-4">Add Contractor</h3>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <input placeholder="Company Name" className="bg-slate-900 border border-slate-600 p-3 rounded" value={contractorForm.name || ''} onChange={e => setContractorForm({...contractorForm, name: e.target.value})} />
                              <input placeholder="Region" className="bg-slate-900 border border-slate-600 p-3 rounded" value={contractorForm.region || ''} onChange={e => setContractorForm({...contractorForm, region: e.target.value})} />
                              <input placeholder="Email" className="bg-slate-900 border border-slate-600 p-3 rounded" value={contractorForm.email || ''} onChange={e => setContractorForm({...contractorForm, email: e.target.value})} />
                              <input placeholder="Phone" className="bg-slate-900 border border-slate-600 p-3 rounded" value={contractorForm.phone || ''} onChange={e => setContractorForm({...contractorForm, phone: e.target.value})} />
                          </div>
                          <div className="flex justify-end mt-4">
                              <Button onClick={handleSaveContractor}>Add Contractor</Button>
                          </div>
                      </div>

                      {contractors.map(c => (
                          <div key={c.id} className="flex justify-between items-center bg-slate-800/50 p-4 rounded border border-slate-700/50 mb-2">
                              <div>
                                  <div className="font-bold">{c.name}</div>
                                  <div className="text-xs text-slate-500">{c.region} | {c.email}</div>
                              </div>
                              <button onClick={() => handleDeleteContractor(c.id)} className="text-red-500 text-sm font-bold">Remove</button>
                          </div>
                      ))}
                   </div>
              )}
              
              {adminTab === 'SETTINGS' && (
                  <div className="animate-fadeIn max-w-xl">
                      <div className="bg-slate-800 rounded-xl p-6 mb-8 border border-slate-700">
                          <h3 className="text-lg font-bold mb-4">API Configuration</h3>
                          <p className="text-sm text-slate-400 mb-4">
                              To use Pro features like 4K generation and Cinematic Video (Veo), you must provide a paid Google GenAI API Key.
                              This key is stored locally in your browser.
                          </p>
                          
                          <div className="space-y-4">
                              <div>
                                  <label className="text-xs font-bold text-slate-500 uppercase">Custom API Key</label>
                                  <input 
                                    type="password" 
                                    placeholder="AIzaSy..." 
                                    className="w-full bg-slate-900 border border-slate-600 p-3 rounded mt-1 text-white font-mono"
                                    value={customApiKey}
                                    onChange={(e) => setCustomApiKey(e.target.value)}
                                  />
                              </div>
                              <div className="flex justify-end gap-3">
                                  <Button variant="secondary" onClick={handleClearApiKey}>Clear Key</Button>
                                  <Button onClick={handleSaveApiKey}>Save Key</Button>
                              </div>
                          </div>
                      </div>
                      
                      <div className="bg-red-900/20 rounded-xl p-6 border border-red-900/50">
                          <h3 className="text-lg font-bold text-red-400 mb-2">Danger Zone</h3>
                          <p className="text-sm text-red-300 mb-4">Reset all catalog data and custom settings.</p>
                          <Button variant="danger" onClick={resetMaterials}>Factory Reset App</Button>
                      </div>
                  </div>
              )}
          </div>
      </div>
  );

  const renderGallery = () => {
    // Filter logic
    const filteredMaterials = materials.filter(m => {
        // Category Filter
        const matchesCategory = categoryUsage === 'All' || m.usage === categoryUsage || 
            (categoryUsage === 'Furniture' && m.category === 'Muebles');
        
        // Search Filter
        const query = searchQuery.toLowerCase();
        const matchesSearch = !searchQuery || 
            m.name.toLowerCase().includes(query) || 
            m.refCode.toLowerCase().includes(query) ||
            m.description.toLowerCase().includes(query) ||
            m.category.toLowerCase().includes(query);

        return matchesCategory && matchesSearch;
    });

    return (
    <div className="min-h-screen bg-slate-900 p-6 flex flex-col">
       <div className="flex justify-between items-center mb-6">
           <Button variant="ghost" onClick={() => setView(AppView.LANDING)}>
               &larr; {t.gallery.back}
           </Button>
           <h2 className="text-xl font-black text-white uppercase tracking-wider">{t.gallery.collection}</h2>
           <div className="w-20"></div> {/* Spacer */}
       </div>
       
       {/* Search Bar */}
       <div className="max-w-2xl mx-auto w-full mb-8">
           <div className="relative group">
               <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                   <svg className="h-5 w-5 text-slate-400 group-focus-within:text-blue-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                   </svg>
               </div>
               <input 
                   type="text"
                   className="block w-full pl-10 pr-3 py-3 border border-slate-700 rounded-xl leading-5 bg-slate-800/50 text-slate-100 placeholder-slate-500 focus:outline-none focus:bg-slate-800 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition-all shadow-lg"
                   placeholder="Search materials, codes, colors..."
                   value={searchQuery}
                   onChange={(e) => setSearchQuery(e.target.value)}
               />
               {searchQuery && (
                   <button 
                       onClick={() => setSearchQuery('')}
                       className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-500 hover:text-white"
                   >
                       <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                       </svg>
                   </button>
               )}
           </div>
       </div>

       <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6 overflow-y-auto pb-20 hide-scroll">
           {filteredMaterials.map(material => (
               <div 
                   key={material.id} 
                   onClick={() => handleSelectMaterial(material)}
                   className="bg-slate-800 rounded-2xl overflow-hidden cursor-pointer group hover:shadow-2xl hover:shadow-blue-900/20 transition-all border border-slate-700/50 hover:border-blue-500/50"
               >
                   <div className="aspect-square relative overflow-hidden">
                       <img 
                            src={material.thumbnailUrl} 
                            alt={material.name} 
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                       />
                       <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                           <span className="text-white font-bold uppercase tracking-widest text-xs border border-white px-3 py-1 rounded-full">{t.steps.select}</span>
                       </div>
                       <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[10px] font-bold px-2 py-0.5 rounded backdrop-blur-sm">
                           ${material.pricing.pricePerUnit}
                       </div>
                   </div>
                   <div className="p-4">
                       <div className="text-[10px] text-blue-400 font-bold uppercase tracking-widest mb-1">{material.refCode}</div>
                       <h3 className="text-white font-bold leading-tight mb-1">{material.name}</h3>
                       <p className="text-slate-500 text-xs truncate">{material.category}</p>
                   </div>
               </div>
           ))}
       </div>

       {filteredMaterials.length === 0 && (
           <div className="text-center text-slate-500 mt-20">
               <p>{t.gallery.noMaterials}</p>
           </div>
       )}
    </div>
  )};

  const renderEditor = () => {
    // Current history item or empty state
    const currentHistory = history[historyIndex];
    const imageToShow = currentHistory?.resultImage || originalImage;
    const materialToShow = currentHistory?.material || selectedMaterial;
    
    return (
    <div className="min-h-screen bg-slate-900 flex flex-col md:flex-row">
       {/* Sidebar Controls */}
       <div className="w-full md:w-96 bg-slate-800 border-r border-slate-700 flex flex-col h-[40vh] md:h-screen overflow-y-auto">
           <div className="p-6 border-b border-slate-700">
               <Button variant="ghost" onClick={() => setView(AppView.GALLERY)} className="mb-4 pl-0 hover:bg-transparent text-slate-400 hover:text-white">
                   &larr; {t.editor.back}
               </Button>
               <h2 className="text-xl font-black text-white uppercase">{t.editor.configuration}</h2>
           </div>
           
           {/* Tabs */}
           <div className="flex border-b border-slate-700">
               <button 
                  onClick={() => setEditorTab('CONFIGURE')} 
                  className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider ${editorTab === 'CONFIGURE' ? 'text-blue-500 border-b-2 border-blue-500 bg-slate-800' : 'text-slate-500 bg-slate-900/50'}`}
               >
                   Visualize
               </button>
               <button 
                  onClick={() => setEditorTab('ANALYZE')} 
                  className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider ${editorTab === 'ANALYZE' ? 'text-purple-500 border-b-2 border-purple-500 bg-slate-800' : 'text-slate-500 bg-slate-900/50'}`}
               >
                   AI Consultant
               </button>
           </div>

           <div className="p-6 space-y-8 flex-1">
               {selectedMaterial && (
                   <div className="bg-slate-700/30 p-4 rounded-xl border border-slate-600/50 flex items-center gap-3">
                       <img src={selectedMaterial.thumbnailUrl} className="w-12 h-12 rounded object-cover bg-slate-800" />
                       <div>
                           <div className="text-[10px] text-blue-400 font-bold uppercase tracking-widest">{t.editor.material}</div>
                           <div className="font-bold text-white leading-tight">{selectedMaterial.name}</div>
                       </div>
                   </div>
               )}

               {editorTab === 'CONFIGURE' ? (
                   <>
                       <div>
                           <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 block">{t.editor.instructions}</label>
                           <textarea 
                               className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-sm text-white h-24 focus:ring-1 focus:ring-blue-500 focus:outline-none resize-none"
                               placeholder="e.g., Make the lighting warmer, remove the chair in the corner..."
                               value={customPrompt}
                               onChange={(e) => setCustomPrompt(e.target.value)}
                           />
                       </div>

                       <div>
                           <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 block">{t.editor.templates}</label>
                           <div className="flex flex-wrap gap-2">
                               {QUICK_TEMPLATES.map(tmpl => (
                                   <button 
                                      key={tmpl}
                                      onClick={() => setCustomPrompt(tmpl)}
                                      className="text-[10px] bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-full transition-colors text-left"
                                   >
                                       {tmpl}
                                   </button>
                               ))}
                           </div>
                       </div>
                   </>
               ) : (
                   <div className="animate-fadeIn">
                       <div className="bg-purple-900/20 border border-purple-500/30 p-4 rounded-xl mb-4">
                           <h4 className="text-purple-400 text-xs font-bold uppercase tracking-widest mb-2">Room Analysis</h4>
                           {generationState.analysis ? (
                               <p className="text-sm text-slate-300 leading-relaxed">{generationState.analysis}</p>
                           ) : (
                               <div className="text-center py-4">
                                   <p className="text-slate-500 text-xs mb-3">Get professional design advice based on your room's geometry and lighting.</p>
                                   <Button onClick={handleRoomAnalysis} isLoading={generationState.isGenerating} variant="secondary" className="w-full text-xs">Analyze Room</Button>
                               </div>
                           )}
                       </div>
                       {/* Video Feature */}
                       <div className="bg-indigo-900/20 border border-indigo-500/30 p-4 rounded-xl">
                            <h4 className="text-indigo-400 text-xs font-bold uppercase tracking-widest mb-2">Cinematic Video</h4>
                            <p className="text-slate-500 text-xs mb-3">Generate a 4K camera pan of your new design.</p>
                            <Button 
                                onClick={handleAnimateVideo} 
                                isLoading={generationState.isGenerating} 
                                disabled={!generationState.resultImage}
                                className="w-full bg-indigo-600 hover:bg-indigo-500 text-xs"
                            >
                                {generationState.resultVideo ? "Regenerate Video" : "Generate Video"}
                            </Button>
                       </div>
                   </div>
               )}
           </div>
           
           <div className="p-6 border-t border-slate-700 bg-slate-800 z-10">
               <Button 
                    onClick={handleGenerate} 
                    isLoading={generationState.isGenerating} 
                    className="w-full py-4 text-sm font-bold uppercase tracking-widest shadow-lg shadow-blue-900/20"
               >
                   {history.length > 0 ? t.editor.regenerate : t.editor.generate}
               </Button>
               {history.length > 0 && (
                   <Button 
                       variant="secondary" 
                       onClick={() => setView(AppView.ESTIMATION)} 
                       className="w-full mt-3 py-3 text-xs font-bold uppercase tracking-widest"
                   >
                       {t.editor.createQuote}
                   </Button>
               )}
           </div>
       </div>

       {/* Main Canvas */}
       <div className="flex-1 bg-black relative flex items-center justify-center p-4 md:p-10 h-[60vh] md:h-screen">
           {generationState.error && (
               <div className="absolute top-4 left-4 right-4 md:left-auto md:right-auto md:w-96 z-50 bg-red-500/10 backdrop-blur border border-red-500 text-red-100 p-4 rounded-xl shadow-2xl flex flex-col gap-3 animate-fadeIn">
                   <div className="flex items-center gap-2">
                       <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                       <span className="font-bold text-xs uppercase tracking-wider">{t.editor.errorTitle}</span>
                   </div>
                   <p className="text-sm">{generationState.error}</p>
                   {/* Add Fix Button if error is permission related */}
                   {(generationState.error.includes("403") || generationState.error.includes("permission")) && (
                       <Button onClick={() => setView(AppView.ADMIN)} className="text-xs w-full bg-red-600 hover:bg-red-500">
                           Fix API Key
                       </Button>
                   )}
               </div>
           )}

           {/* Video Overlay if Video exists */}
           {currentHistory?.resultVideo ? (
               <div className="relative w-full max-w-5xl aspect-video rounded-xl overflow-hidden shadow-2xl border border-slate-800">
                   <video 
                        src={currentHistory.resultVideo} 
                        controls 
                        autoPlay 
                        loop
                        className="w-full h-full object-cover"
                   />
                   <button 
                        onClick={() => {
                            // Clear video view to go back to image comparison
                            const updated = [...history];
                            updated[historyIndex].resultVideo = null;
                            setHistory(updated);
                        }}
                        className="absolute top-4 left-4 bg-black/50 text-white px-3 py-1 rounded text-xs font-bold uppercase hover:bg-black/80"
                   >
                       &larr; Back to Image
                   </button>
               </div>
           ) : (
                originalImage && imageToShow ? (
                    <div className="w-full max-w-5xl">
                        <ImageComparator 
                            beforeImage={originalImage}
                            afterImage={imageToShow!}
                            materialThumbnail={materialToShow?.thumbnailUrl}
                        />
                        {/* History Navigation Dots */}
                        {history.length > 0 && (
                            <div className="flex justify-center gap-2 mt-4">
                                <button 
                                    onClick={() => setHistoryIndex(-1)}
                                    className={`w-2 h-2 rounded-full transition-all ${historyIndex === -1 ? 'bg-white scale-125' : 'bg-slate-700 hover:bg-slate-500'}`}
                                />
                                {history.map((_, idx) => (
                                    <button 
                                        key={idx}
                                        onClick={() => setHistoryIndex(idx)}
                                        className={`w-2 h-2 rounded-full transition-all ${historyIndex === idx ? 'bg-blue-500 scale-125' : 'bg-slate-700 hover:bg-slate-500'}`}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="text-slate-600 font-mono text-sm animate-pulse">Waiting for image...</div>
                )
           )}
       </div>
    </div>
  )};

  const renderCart = () => {
    // Helper to clear cart
    const clearCart = () => {
        localStorage.removeItem('constructVizCart');
        setCartCount(0);
        setView(AppView.LANDING);
    };

    const getCart = (): CartItem[] => {
        try {
            return JSON.parse(localStorage.getItem('constructVizCart') || '[]');
        } catch { return []; }
    };
    const cartItems = getCart();
    const total = cartItems.reduce((sum, item) => sum + item.totalCost, 0);

    const prepareCheckout = () => {
        let body = "Hi, I would like to place an order for the following materials:\n\n";
        cartItems.forEach((item, i) => {
            body += `${i+1}. ${item.material.name} (Ref: ${item.material.refCode})\n`;
            body += `   Quantity: ${item.quantity} ${item.material.pricing.unitLabel}\n`;
            body += `   Dimensions: ${item.dimensions.width}x${item.dimensions.height}\n`;
            body += `   Cost: $${item.totalCost.toFixed(2)}\n\n`;
        });
        body += `TOTAL ESTIMATED: $${total.toFixed(2)}`;
        setCheckoutBody(body);
        setShowCheckoutModal(true);
    };

    return (
      <div className="min-h-screen bg-slate-900 p-6 md:p-12 flex flex-col items-center">
          <div className="max-w-4xl w-full">
              <div className="flex justify-between items-center mb-8 border-b border-slate-800 pb-6">
                  <h1 className="text-3xl font-black text-white uppercase">{t.cart.title}</h1>
                  <Button variant="ghost" onClick={() => setView(AppView.LANDING)}>&larr; {t.cart.continue}</Button>
              </div>

              {cartItems.length === 0 ? (
                  <div className="text-center py-20 bg-slate-800/30 rounded-2xl border border-slate-700 border-dashed">
                      <p className="text-slate-500 text-lg mb-6">{t.cart.empty}</p>
                      <Button onClick={() => setView(AppView.LANDING)}>{t.cart.browse}</Button>
                  </div>
              ) : (
                  <div className="space-y-4">
                      {cartItems.map((item, idx) => (
                          <div key={item.id} className="bg-slate-800 p-4 rounded-xl flex items-center gap-4 border border-slate-700">
                              <img src={item.material.thumbnailUrl} className="w-16 h-16 rounded object-cover bg-slate-900" />
                              <div className="flex-1">
                                  <h3 className="font-bold text-white text-lg">{item.material.name}</h3>
                                  <p className="text-sm text-slate-400">{item.quantity} {item.material.pricing.unitLabel} • {item.dimensions.width}m x {item.dimensions.height}m</p>
                              </div>
                              <div className="text-right">
                                  <div className="font-bold text-green-400 text-xl">${item.totalCost.toFixed(2)}</div>
                                  <button 
                                    onClick={() => {
                                        const newCart = cartItems.filter(c => c.id !== item.id);
                                        localStorage.setItem('constructVizCart', JSON.stringify(newCart));
                                        updateCartCount();
                                        // Force re-render hack or just rely on state update if we moved cart to state
                                        // For now, simpler to just setView to force refresh or use state for items
                                        // Ideally we lift state, but for this demo:
                                        setView(AppView.CART); // Re-render
                                    }}
                                    className="text-xs text-red-500 hover:text-red-400 font-bold uppercase mt-1"
                                  >
                                      {t.cart.remove}
                                  </button>
                              </div>
                          </div>
                      ))}
                      
                      <div className="flex justify-between items-center bg-black p-6 rounded-xl border border-slate-800 mt-8">
                          <span className="text-slate-400 font-bold uppercase tracking-widest">{t.cart.total}</span>
                          <span className="text-4xl font-black text-white">${total.toFixed(2)}</span>
                      </div>

                      <div className="flex justify-end gap-4 mt-8">
                           <Button variant="secondary" onClick={clearCart}>Clear Cart</Button>
                           <Button onClick={prepareCheckout} className="px-8 py-4 text-lg">{t.cart.checkout}</Button>
                      </div>
                  </div>
              )}
          </div>

          {/* Checkout Modal */}
          {showCheckoutModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-fadeIn">
                  <div className="bg-slate-800 max-w-lg w-full rounded-2xl p-8 border border-slate-700 shadow-2xl">
                      <h3 className="text-2xl font-bold text-white mb-4">{t.cart.confirmOrder}</h3>
                      <p className="text-slate-400 mb-4 text-sm">We will generate an email with your order details. Please review before sending.</p>
                      <textarea 
                        readOnly 
                        className="w-full h-48 bg-slate-900 border border-slate-700 rounded p-4 text-slate-300 font-mono text-xs mb-6 focus:outline-none"
                        value={checkoutBody}
                      />
                      <div className="flex gap-3 justify-end">
                          <Button variant="secondary" onClick={() => setShowCheckoutModal(false)}>{t.common.cancel}</Button>
                          <Button onClick={() => {
                              window.open(`mailto:sales@buildinginnovation.com?subject=New Order&body=${encodeURIComponent(checkoutBody)}`);
                              setShowCheckoutModal(false);
                          }}>{t.cart.openGmail}</Button>
                      </div>
                  </div>
              </div>
          )}
      </div>
    );
  };

  return (
    <div className="font-sans text-slate-50 selection:bg-blue-500 selection:text-white">
      {view === AppView.LOGIN && renderLogin()}
      {view === AppView.LANDING && renderLanding()}
      {view === AppView.ADMIN && renderAdmin()}
      {view === AppView.GALLERY && renderGallery()}
      {view === AppView.CART && renderCart()}
      {view === AppView.CAMERA && (
        <div className="h-screen bg-slate-900 p-6 flex flex-col items-center justify-center">
            <div className="w-full max-w-4xl flex-1 flex flex-col">
                <div className="flex justify-between items-center mb-6">
                     <Button variant="ghost" onClick={() => setView(AppView.GALLERY)}>&larr; {t.common.back}</Button>
                     <h2 className="text-xl font-bold text-white uppercase">{t.steps.capture}</h2>
                     <div className="w-10"></div>
                </div>
                <div className="flex-1 bg-black rounded-3xl overflow-hidden border border-slate-800 shadow-2xl relative">
                    <CameraCapture onImageCapture={handleImageCapture} lang={lang} />
                </div>
            </div>
        </div>
      )}
      {view === AppView.EDITOR && renderEditor()}
      {view === AppView.ESTIMATION && selectedMaterial && (
        <div className="h-screen bg-slate-900 p-2 md:p-6 flex flex-col">
            <EstimationPanel 
                material={selectedMaterial} 
                onBack={() => setView(AppView.EDITOR)}
                onAddToCart={() => updateCartCount()} 
                onNewQuote={() => {
                    setView(AppView.GALLERY);
                    setSelectedMaterial(null);
                    setHistory([]);
                }}
                contractors={contractors}
                lang={lang}
            />
        </div>
      )}
    </div>
  );
};

export default App;
