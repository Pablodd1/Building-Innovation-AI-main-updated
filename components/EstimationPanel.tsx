
import React, { useState, useEffect, useMemo } from 'react';
import { Material, CartItem, Contractor } from '../types';
import { Button } from './Button';
import { TRANSLATIONS } from '../constants';
import { jsPDF } from 'jspdf';

import { 
  formatDimensionUSA, 
  formatMetersUSA, 
  formatAreaUSA, 
  feetInchesToMeters, 
  metersToFeetInches 
} from '../services/unitUtils';

function formatDimensionCM(cm: number): string {
  return `${cm.toFixed(1)} cm`;
}

interface EstimationPanelProps {
  material: Material;
  onBack: () => void;
  onAddToCart?: () => void;
  onNewQuote?: () => void;
  contractors?: Contractor[];
  lang?: 'en' | 'es';
  unitSystem?: 'latam' | 'usa';
  userEmail?: string;
  userName?: string;
  userLocation?: { lat: number; lon: number } | null;
}

// Logo Component
const BrandLogoSmall = ({ className = "stroke-white print:stroke-black" }: { className?: string }) => (
  <svg width="32" height="32" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M10 20L20 15L30 20" className={className} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M10 26L20 21L30 26" className={className} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M10 32L20 27L30 32" className={className} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M5 10L20 2L35 10" className={className} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const geocodeColombiaAddress = async (address: string) => {
    try {
        const res = await fetch('https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(address + ', Colombia'));
        if (res.ok) {
            const data = await res.json();
            if (data && data.length > 0) {
                return { 
                    lat: parseFloat(data[0].lat), 
                    lon: parseFloat(data[0].lon), 
                    city: data[0].display_name.split(',')[0] 
                };
            }
        }
    } catch (e) {
        console.error('Nominatim Geocoding error:', e);
    }
    // Fallback if API fails or no result
    return { lat: 4.6097, lon: -74.0817, city: 'Bogotá (Fallback)' };
};
const calculateHaversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371; // Radius of Earth in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in km
};

export const EstimationPanel: React.FC<EstimationPanelProps> = ({ material, onBack, onAddToCart, onNewQuote, contractors = [], lang = 'en', unitSystem = 'usa', userEmail = '', userName = '', userLocation = null }) => {
  const [width, setWidth] = useState<number>(3);
  const [height, setHeight] = useState<number>(2.5);

  // USA System States
  const [widthFeet, setWidthFeet] = useState<number>(9);
  const [widthInches, setWidthInches] = useState<number>(10);
  const [heightFeet, setHeightFeet] = useState<number>(8);
  const [heightInches, setHeightInches] = useState<number>(2);

  const [quantity, setQuantity] = useState<number>(0);
  const [totalCost, setTotalCost] = useState<number>(0);
  const [useManualCost, setUseManualCost] = useState<boolean>(false);
  const [manualTotalCost, setManualTotalCost] = useState<number>(0);

  const [patternRepeat, setPatternRepeat] = useState<number>(material.specs?.patternRepeat || 0);
  const [wasteFactor, setWasteFactor] = useState<number>(material.specs?.recommendedWaste || 0.10);
  const [layoutStyle, setLayoutStyle] = useState<'STRAIGHT' | 'DIAGONAL'>('STRAIGHT');

  const [breakdown, setBreakdown] = useState<string[]>([]);

  const [addedToCart, setAddedToCart] = useState<boolean>(false);
  const [selectedContractor, setSelectedContractor] = useState<string>('');
  const [laborCost, setLaborCost] = useState<number>(0);
  const [manualLaborOverride, setManualLaborOverride] = useState<boolean>(false);
  const [emailStatus, setEmailStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [emailError, setEmailError] = useState<string>('');
  
  const [nearbyInstallers, setNearbyInstallers] = useState<any[]>([]);
  const [isSearchingInstallers, setIsSearchingInstallers] = useState(false);
  const [userAddress, setUserAddress] = useState<string>('');
  const [geocodedLocation, setGeocodedLocation] = useState<{ lat: number; lon: number; city: string } | null>(null);

  const sortedContractors = useMemo(() => {
      if (!geocodedLocation) return contractors;
      return contractors
          .map((c) => {
              if (c.lat !== undefined && c.lon !== undefined) {
                  const dist = calculateHaversineDistance(
                      geocodedLocation.lat,
                      geocodedLocation.lon,
                      c.lat,
                      c.lon
                  );
                  return { ...c, distance_km: dist };
              }
              return { ...c, distance_km: null } as any;
          })
          .sort((a, b) => {
              if (a.distance_km === null) return 1;
              if (b.distance_km === null) return -1;
              return a.distance_km - b.distance_km;
          });
  }, [contractors, geocodedLocation]);

  const fetchNearbyInstallers = async () => {
    if (!userLocation) return;
    setIsSearchingInstallers(true);
    try {
        const res = await fetch('/api/marketplace/installers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: userLocation.lat, lon: userLocation.lon })
        });
        if (res.ok) {
            const data = await res.json();
            setNearbyInstallers(data);
        }
    } catch (e) {
        console.error('Failed to fetch installers:', e);
    } finally {
        setIsSearchingInstallers(false);
    }
  };

  const handleAddressChange = async (address: string) => {
      if (!address || address.trim().length < 5) {
          setGeocodedLocation(null);
          return;
      }
      const loc = await geocodeColombiaAddress(address);
      setGeocodedLocation(loc);
  };

  const t = TRANSLATIONS[lang];
  const isUSA = unitSystem === 'usa';

  // Sync Meters with Feet/Inches for USA mode
  useEffect(() => {
    if (isUSA) {
      const w = feetInchesToMeters(widthFeet, widthInches);
      const h = feetInchesToMeters(heightFeet, heightInches);
      setWidth(w);
      setHeight(h);
    }
  }, [widthFeet, widthInches, heightFeet, heightInches, isUSA]);

  // Reverse sync when switching TO USA mode to initialize fields
  useEffect(() => {
    if (isUSA) {
       const wInfo = metersToFeetInches(width);
       setWidthFeet(wInfo.feet);
       setWidthInches(Math.round(wInfo.inches));
       
       const hInfo = metersToFeetInches(height);
       setHeightFeet(hInfo.feet);
       setHeightInches(Math.round(hInfo.inches));
    }
  }, [isUSA]);

  useEffect(() => {
    // Determine Calculation Mode based on Material Specs or Category fallback
    const mode = material.specs?.installationType || 
                 (material.category === 'Zocalos' ? 'LINEAR' : 
                  material.category === 'Rollos Adhesivos' ? 'ROLL' : 'TILE');

    let calculatedQty = 0;
    const log: string[] = [];
    const u = isUSA ? 'ft' : 'm';
    const a = isUSA ? 'ft²' : 'm²';
    const fmt = (val: number) => isUSA ? formatMetersUSA(val) : `${val.toFixed(2)}m`;
    const fmtArea = (val: number) => isUSA ? formatAreaUSA(val) : `${val.toFixed(2)}m²`;

    // Basic Product Specs
    const matWidthM = material.dimensions.width / 100; // cm -> m
    const matLengthM = material.dimensions.length / 100; // cm -> m
    const itemsPerBox = material.pricing.itemsPerBox || 1;

    // --- ALGORITHM A: WALLPAPER & ROLLS (By Area/Strips) ---
    if (mode === 'ROLL') {
        const repeatM = patternRepeat / 100; // cm to m

        // 1. Calculate Strips needed to cover width
        const strips = Math.ceil(width / matWidthM);

        // 2. Add Waste Strips
        const wasteStrips = Math.ceil(strips * wasteFactor);
        const totalStrips = strips + wasteStrips;

        log.push(`${lang === 'es' ? 'Cobertura' : 'Coverage'}: ${fmt(width)} / ${fmt(matWidthM)} (${lang === 'es' ? 'ancho rollo' : 'roll width'}) = ${strips} ${lang === 'es' ? 'tiras' : 'strips'}.`);
        log.push(`${lang === 'es' ? 'Desperdicio' : 'Waste'} ${(wasteFactor*100).toFixed(0)}%: +${wasteStrips} ${lang === 'es' ? 'tiras' : 'strips'}.`);

        // 3. Calculate working length per strip (including pattern match)
        let workingLength = height;
        if (repeatM > 0) {
            workingLength = Math.ceil(height / repeatM) * repeatM;
            log.push(`${lang === 'es' ? 'Patrón' : 'Pattern'} (${patternRepeat}cm): ${lang === 'es' ? 'Alto ajustado' : 'Height adjusted'} ${fmt(height)} -> ${fmt(workingLength)}.`);
        } else {
            workingLength = height + 0.10; // 10cm trim
            log.push(lang === 'es' ? `Sin patrón: +${isUSA ? '4"' : '10cm'} margen.` : `Trim: Added ${isUSA ? '4"' : '10cm'} safety.`);
        }

        // 4. Calculate Rolls Needed
        const stripsPerRoll = Math.floor(matLengthM / workingLength);

        if (stripsPerRoll >= 1) {
            calculatedQty = Math.ceil(totalStrips / stripsPerRoll);
            log.push(`1 ${lang === 'es' ? 'Rollo' : 'Roll'} (${fmt(matLengthM)}) = ${stripsPerRoll} ${lang === 'es' ? 'tiras útiles' : 'usable strips'}.`);
            log.push(`Total: ${totalStrips} ${lang === 'es' ? 'tiras' : 'strips'} -> ${calculatedQty} ${lang === 'es' ? 'Rollos' : 'Rolls'}.`);
        } else {
            // Wall is taller than roll length (rare for wallpaper, possible for other rolls)
            const totalMetersNeeded = totalStrips * workingLength;
            calculatedQty = Math.ceil(totalMetersNeeded / matLengthM);
            log.push(`${lang === 'es' ? 'Alto > Largo Rollo. Total metros' : 'Wall height > Roll length. Total units'}: ${fmt(totalMetersNeeded)}.`);
        }
    } 
    // --- ALGORITHM B: FLOORING & TILES (By Piece/Box) ---
    else if (mode === 'TILE') {
        // 1. Calculate Real Area
        const area = width * height;
        log.push(`${lang === 'es' ? 'Área Superficie' : 'Surface Area'}: ${fmtArea(area)}`);

        // 2. Apply Waste
        const effectiveWaste = layoutStyle === 'DIAGONAL' ? 0.15 : wasteFactor;
        const totalAreaWithWaste = area * (1 + effectiveWaste);
        log.push(`${lang === 'es' ? 'Desperdicio' : 'Waste'} (${(effectiveWaste*100).toFixed(0)}%): Total ${fmtArea(totalAreaWithWaste)}`);

        // 3. Calculate Single Piece Area
        const pieceArea = matWidthM * matLengthM;

        // 4. Calculate Total Pieces
        const totalPieces = Math.ceil(totalAreaWithWaste / pieceArea);
        log.push(`${lang === 'es' ? 'Tamaño Ítem' : 'Item Size'}: ${material.dimensions.width}x${material.dimensions.length}cm (${fmtArea(pieceArea)})`);
        log.push(`${lang === 'es' ? 'Piezas Necesarias' : 'Pieces Needed'}: ${totalPieces}.`);

        // 5. Convert to Purchasing Unit (Boxes vs Pieces)
        if (itemsPerBox > 1) {
            calculatedQty = Math.ceil(totalPieces / itemsPerBox);
            log.push(`${lang === 'es' ? 'Empaque' : 'Packaging'}: ${itemsPerBox} ${lang === 'es' ? 'ítems/caja' : 'items/box'}.`);
            log.push(`${lang === 'es' ? 'Cálculo' : 'Calculation'}: ${totalPieces} / ${itemsPerBox} = ${calculatedQty} ${lang === 'es' ? 'Cajas' : 'Boxes'}.`);
        } else {
            calculatedQty = totalPieces;
            log.push(lang === 'es' ? "Venta individual." : "Sold individually.");
        }
    }
    // --- ALGORITHM C: LINEAR (Baseboards) ---
    else if (mode === 'LINEAR') {
        const perimeter = width; // Input field reused as "Length/Perimeter"

        const totalLen = perimeter * (1 + wasteFactor);
        const pieces = Math.ceil(totalLen / matWidthM); // In Linear mode, 'width' dimension is usually length of the plank

        // Check if sold by box
        if (itemsPerBox > 1) {
            calculatedQty = Math.ceil(pieces / itemsPerBox);
            log.push(`${lang === 'es' ? 'Total Lineal' : 'Linear Total'}: ${fmt(totalLen)}.`);
            log.push(`${lang === 'es' ? 'Piezas' : 'Pieces'}: ${pieces} (${fmt(matWidthM)} ${lang === 'es' ? 'c/u' : 'each'}).`);
            log.push(`${lang === 'es' ? 'Empaque' : 'Packaging'}: ${pieces} / ${itemsPerBox} = ${calculatedQty} ${lang === 'es' ? 'Cajas' : 'Boxes'}.`);
        } else {
            calculatedQty = pieces;
            log.push(`${lang === 'es' ? 'Largo Total' : 'Total Length'}: ${fmt(totalLen)}.`);
            log.push(`${lang === 'es' ? 'Total Unidades' : 'Total Units'}: ${pieces}.`);
        }
    }

    setQuantity(calculatedQty);
    const materialCost = calculatedQty * material.pricing.pricePerUnit;
    setTotalCost(materialCost);
    setBreakdown(log);

  }, [width, height, material, patternRepeat, wasteFactor, layoutStyle, lang, selectedContractor, manualLaborOverride, laborCost, contractors]);

  useEffect(() => {
    if (selectedContractor && !manualLaborOverride) {
      const contractor = contractors.find(c => c.id === selectedContractor);
      if (contractor) {
        const mode = material.specs?.installationType || 
          (material.category === 'Zocalos' ? 'LINEAR' : 
           material.category === 'Rollos Adhesivos' ? 'ROLL' : 'TILE');
        
        let calculatedLabor = 0;
        const area = width * height;
        
        if (mode === 'TILE' && contractor.laborRatePerSqm) {
          calculatedLabor = area * contractor.laborRatePerSqm * (1 + wasteFactor);
        } else if (mode === 'LINEAR' && contractor.laborRatePerLinear) {
          calculatedLabor = width * contractor.laborRatePerLinear * (1 + wasteFactor);
        } else if (mode === 'ROLL' && contractor.laborRatePerPiece) {
          calculatedLabor = quantity * (contractor.laborRatePerPiece || 0);
        }
        
        setLaborCost(Math.round(calculatedLabor));
      }
    }
  }, [selectedContractor, contractors, material, width, height, wasteFactor, quantity, manualLaborOverride]);

  const totalWithLabor = totalCost + laborCost;
  const displayCost = useManualCost ? manualTotalCost : (laborCost > 0 ? totalWithLabor : totalCost);

  const handleAddToCart = () => {
    const newItem: CartItem = {
        id: `${material.id}-${Date.now()}`,
        material: material,
        quantity: quantity,
        totalCost: displayCost,
        dimensions: { width, height },
        timestamp: Date.now()
    };
    try {
        const existingCartJson = localStorage.getItem('constructVizCart');
        const cart: CartItem[] = existingCartJson ? JSON.parse(existingCartJson) : [];
        cart.push(newItem);
        localStorage.setItem('constructVizCart', JSON.stringify(cart));
        setAddedToCart(true);
        if (onAddToCart) onAddToCart();
        setTimeout(() => setAddedToCart(false), 3000);
    } catch (e) {}
  };

  const generatePDF = () => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;
    let y = 20;

    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text('Building Innovation', margin, y);
    
    y += 10;
    doc.setFontSize(16);
    doc.text('Quote / Cotización', margin, y);
    
    y += 15;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text(`Date: ${new Date().toLocaleDateString()}`, margin, y);
    
    y += 15;
    doc.setLineWidth(0.5);
    doc.line(margin, y, pageWidth - margin, y);
    
    y += 10;
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(`Material: ${material.name}`, margin, y);
    
    y += 7;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Ref: ${material.refCode}`, margin, y);
    
    y += 10;
    const dimCM = `${material.dimensions.width} x ${material.dimensions.length} cm`;
    const dimUSA = `${formatDimensionUSA(material.dimensions.width)} x ${formatDimensionUSA(material.dimensions.length)}"`;
    doc.text(`Dimensions: ${dimCM} | ${dimUSA}`, margin, y);
    
    y += 15;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Project Details:', margin, y);
    
    y += 8;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const areaValue = !isUSA ? (width * height).toFixed(2) : formatAreaUSA(width * height).replace(' ft²', '');
    doc.text(`${isLinear ? 'Linear / Perimeter' : 'Area'}: ${isLinear ? (!isUSA ? `${width}m` : formatMetersUSA(width)) : (!isUSA ? `${(width * height).toFixed(2)} m²` : formatAreaUSA(width * height))}`, margin, y);
    
    y += 6;
    doc.text(`Quantity: ${quantity} ${material.pricing.unitLabel}`, margin, y);
    
    y += 15;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Cost Breakdown:', margin, y);
    
    y += 8;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Material Cost: $${Math.round(displayCost)}`, margin, y);
    
    if (laborCost > 0) {
        y += 6;
        doc.text(`Installation Cost: $${laborCost}`, margin, y);
    }
    
    y += 10;
    doc.setFont('helvetica', 'bold');
    const totalLabel = laborCost > 0 ? 'TOTAL' : 'Estimated Cost';
    doc.text(`${totalLabel}: $${Math.round(displayCost)}`, margin, y);
    
    if (selectedContractorData) {
        y += 20;
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('Assigned Contractor:', margin, y);
        
        y += 8;
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text(`Name: ${selectedContractorData.name}`, margin, y);
        y += 5;
        doc.text(`Region: ${selectedContractorData.region}`, margin, y);
        y += 5;
        doc.text(`Phone: ${selectedContractorData.phone}`, margin, y);
        y += 5;
        doc.text(`Email: ${selectedContractorData.email}`, margin, y);
    }
    
    y += 20;
    doc.setFontSize(8);
    doc.setTextColor(128);
    doc.text('Building Innovation - We design the future!', pageWidth / 2, y, { align: 'center' });
    
    doc.save(`Quote_${material.refCode}_${Date.now()}.pdf`);
  };

  const handleDownloadPDF = generatePDF;

  const handleSendEmail = async () => {
      if (!userEmail) {
          setEmailStatus('error');
          setEmailError(lang === 'es' ? 'No se encontró email de usuario. Inicie sesión primero.' : 'User email not found. Please log in first.');
          return;
      }
      setEmailStatus('sending');
      setEmailError('');
      try {
          const response = await fetch('/api/send-quote-email', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  materialName: material.name,
                  refCode: material.refCode,
                  quantity,
                  unitLabel: material.pricing.unitLabel,
                  width,
                  height,
                  estimatedCost: displayCost,
                  userEmail,
                  userName,
              }),
          });
          const data = await response.json();
          if (data.success) {
              setEmailStatus('sent');
              setTimeout(() => setEmailStatus('idle'), 4000);
          } else {
              setEmailStatus('error');
              setEmailError(data.error || (lang === 'es' ? 'Error al enviar email' : 'Failed to send email'));
          }
      } catch (err: any) {
          setEmailStatus('error');
          setEmailError(err.message || (lang === 'es' ? 'Error de conexión' : 'Connection error'));
      }
  };

  const selectedContractorData = contractors.find(c => c.id === selectedContractor);
  const isLinear = material.category === 'Zocalos' || material.specs?.installationType === 'LINEAR';
  const isRoll = material.category === 'Rollos Adhesivos' || material.specs?.installationType === 'ROLL';

  return (
    <div id="print-area" className="bg-slate-900 print:bg-white border border-slate-700 print:border-none rounded-none md:rounded-lg overflow-hidden shadow-2xl flex flex-col h-full animate-fadeIn">
      {/* Header */}
      <div className="bg-black print:bg-white p-4 md:p-6 border-b border-slate-800 print:border-black flex flex-col sm:flex-row justify-between items-start gap-4">
        <div className="flex items-center gap-4">
            <img 
                src={material.imageUrl} 
                alt={material.name}
                className="w-16 h-16 md:w-20 md:h-20 object-cover border border-slate-700 print:border-slate-200 print:block rounded"
            />
            <div>
                <div className="flex items-center space-x-2 mb-1">
                    <BrandLogoSmall />
                    <span className="text-[10px] md:text-xs font-bold tracking-widest text-slate-400 print:text-slate-600 uppercase">Building Innovation</span>
                </div>
                <h2 className="text-xl md:text-2xl font-black text-white print:text-black uppercase leading-none">{material.name}</h2>
                <div className="text-blue-500 print:text-black font-bold text-sm tracking-wider mt-1">REF: {material.refCode}</div>
                <div className="text-xs text-slate-500 mt-1">
                    {!isUSA ? (
                        <>
                            {formatDimensionCM(material.dimensions.width)} x {formatDimensionCM(material.dimensions.length)}cm • {material.dimensions.thickness}mm
                        </>
                    ) : (
                        <span className="text-blue-400">{formatDimensionUSA(material.dimensions.width)} x {formatDimensionUSA(material.dimensions.length)}" • {material.dimensions.thickness}mm</span>
                    )}
                </div>
            </div>
        </div>
        <div className="text-left sm:text-right hidden sm:block">
            <div className="text-xs text-slate-500 print:text-slate-600 uppercase">{t.quote.date}</div>
            <div className="text-white print:text-black text-sm font-medium">{new Date().toLocaleDateString()}</div>
        </div>
      </div>

      <div className="p-4 md:p-8 overflow-y-auto flex-1 space-y-8 print:space-y-6">

        {/* INPUTS SECTION */}
        <section>
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center">
                    <div className="bg-blue-600 print:bg-black text-white text-xs font-bold px-2 py-1 mr-2 rounded">1</div>
                    <h3 className="text-sm font-bold text-white print:text-black uppercase tracking-wider">
                        {isLinear ? t.quote.linear : t.quote.area}
                    </h3>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                {/* Width Input Block */}
                <div className="bg-black print:bg-white p-4 md:p-5 border border-slate-800 print:border-slate-200 group rounded-lg">
                    <label className="block text-[10px] font-bold text-slate-500 print:text-slate-600 uppercase tracking-widest mb-2">
                            {isLinear ? t.quote.perimeter : t.quote.width} {!isUSA ? '(m)' : '(USA)'}
                    </label>
                    {!isUSA ? (
                        <input 
                            type="number" 
                            value={width}
                            onChange={(e) => setWidth(parseFloat(e.target.value) || 0)}
                            step="0.1"
                            className="bg-transparent text-2xl md:text-3xl font-black text-white print:text-black w-full focus:outline-none"
                        />
                    ) : (
                        <div className="flex items-end gap-2">
                             <div className="flex-1">
                                <input 
                                    type="number" 
                                    value={widthFeet}
                                    onChange={(e) => setWidthFeet(parseInt(e.target.value) || 0)}
                                    className="bg-transparent text-2xl md:text-3xl font-black text-white print:text-black w-full focus:outline-none"
                                />
                                <span className="text-[10px] text-slate-600 font-bold uppercase">{t.common.ft || 'ft'}</span>
                             </div>
                             <div className="flex-1 border-l border-slate-800 pl-2">
                                <input 
                                    type="number" 
                                    value={widthInches}
                                    onChange={(e) => setWidthInches(parseInt(e.target.value) || 0)}
                                    max="11"
                                    className="bg-transparent text-2xl md:text-3xl font-black text-white print:text-black w-full focus:outline-none"
                                />
                                <span className="text-[10px] text-slate-600 font-bold uppercase">{t.common.inch || 'in'}</span>
                             </div>
                        </div>
                    )}
                </div>

                {/* Height Input Block */}
                {!isLinear && (
                    <div className="bg-black print:bg-white p-4 md:p-5 border border-slate-800 print:border-slate-200 group rounded-lg">
                        <label className="block text-[10px] font-bold text-slate-500 print:text-slate-600 uppercase tracking-widest mb-2">
                            {t.quote.height} {!isUSA ? '(m)' : '(USA)'}
                        </label>
                        {!isUSA ? (
                            <input 
                                type="number" 
                                value={height}
                                onChange={(e) => setHeight(parseFloat(e.target.value) || 0)}
                                step="0.1"
                                className="bg-transparent text-2xl md:text-3xl font-black text-white print:text-black w-full focus:outline-none"
                            />
                        ) : (
                            <div className="flex items-end gap-2">
                                <div className="flex-1">
                                    <input 
                                        type="number" 
                                        value={heightFeet}
                                        onChange={(e) => setHeightFeet(parseInt(e.target.value) || 0)}
                                        className="bg-transparent text-2xl md:text-3xl font-black text-white print:text-black w-full focus:outline-none"
                                    />
                                    <span className="text-[10px] text-slate-600 font-bold uppercase">{t.common.ft || 'ft'}</span>
                                </div>
                                <div className="flex-1 border-l border-slate-800 pl-2">
                                    <input 
                                        type="number" 
                                        value={heightInches}
                                        onChange={(e) => setHeightInches(parseInt(e.target.value) || 0)}
                                        max="11"
                                        className="bg-transparent text-2xl md:text-3xl font-black text-white print:text-black w-full focus:outline-none"
                                    />
                                    <span className="text-[10px] text-slate-600 font-bold uppercase">{t.common.inch || 'in'}</span>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* ADVANCED SETTINGS */}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 no-print">
                {!isLinear && !isRoll && (
                    <div className="bg-slate-800 p-3 rounded border border-slate-700">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">{t.quote.pattern}</label>
                        <select 
                            value={layoutStyle}
                            onChange={e => setLayoutStyle(e.target.value as any)}
                            className="w-full bg-black text-white text-base md:text-sm p-2 rounded"
                        >
                            <option value="STRAIGHT">Straight</option>
                            <option value="DIAGONAL">Diagonal</option>
                        </select>
                    </div>
                )}

                {isRoll && (
                    <div className="bg-slate-800 p-3 rounded border border-slate-700">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Pattern Repeat (cm)</label>
                        <input 
                            type="number" 
                            value={patternRepeat} 
                            onChange={e => setPatternRepeat(parseFloat(e.target.value))}
                            className="w-full bg-black text-white text-base md:text-sm p-2 rounded"
                        />
                    </div>
                )}

                <div className="bg-slate-800 p-3 rounded border border-slate-700">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">{t.quote.waste}</label>
                    <select 
                        value={wasteFactor}
                        onChange={e => setWasteFactor(parseFloat(e.target.value))}
                        className="w-full bg-black text-white text-base md:text-sm p-2 rounded"
                    >
                        <option value="0">0%</option>
                        <option value="0.05">5%</option>
                        <option value="0.10">10% ({lang === 'es' ? 'Rec.' : 'Rec.'})</option>
                        <option value="0.15">15%</option>
                    </select>
                </div>
            </div>
        </section>

        {/* LOGIC BREAKDOWN */}
        <section className="bg-slate-800/20 print:bg-slate-50 border border-slate-700 print:border-slate-200 p-4 rounded text-sm text-slate-400 print:text-slate-600">
             <div className="flex items-center gap-2 mb-2">
                <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span className="font-bold uppercase text-xs tracking-wider text-white print:text-black">{t.quote.breakdown}</span> 
             </div>
             <ul className="list-disc list-inside space-y-1 text-xs font-mono">
                {breakdown.map((log, i) => <li key={i}>{log}</li>)}
             </ul>
        </section>

        {/* SUMMARY */}
        <section className="border-t border-slate-800 print:border-slate-200 pt-8 print:pt-4">
            <div className="flex items-center mb-4">
                <div className="bg-slate-700 print:bg-slate-200 print:text-black text-white text-xs font-bold px-2 py-1 mr-2 rounded">2</div>
                <h3 className="text-sm font-bold text-white print:text-black uppercase tracking-wider">{t.quote.summary}</h3>
            </div>

            <div className="bg-slate-800/30 print:bg-white border border-slate-700 print:border-slate-200 p-6 rounded-lg">
                <div className="flex justify-between items-center mb-4 pb-4 border-b border-slate-700/50 print:border-slate-200">
                    <span className="text-slate-400 print:text-slate-600 text-sm uppercase tracking-wide">
                         {t.quote.dimensions}
                    </span>
                    <span className="text-white print:text-black font-mono font-bold text-right">
                         <div className="text-sm">{!isUSA ? (isLinear ? `${width.toFixed(2)}m` : `${width.toFixed(2)}m x ${height.toFixed(2)}m`) : (isLinear ? formatMetersUSA(width) : `${formatMetersUSA(width)} x ${formatMetersUSA(height)}`)}</div>
                         {isUSA && <div className="text-xs text-blue-400">({isLinear ? `${width.toFixed(2)}m` : `${width.toFixed(2)}m x ${height.toFixed(2)}m`})</div>}
                    </span>
                </div>

                <div className="flex justify-between items-end mb-2">
                    <span className="text-white print:text-black font-bold text-base md:text-lg uppercase">{t.quote.quantity}</span>
                    <span className="text-3xl font-black text-blue-500 print:text-black">{quantity} <span className="text-lg text-slate-400 print:text-slate-600 font-medium">{material.pricing.unitLabel}</span></span>
                </div>

                {/* Cost Breakdown */}
                <div className="mt-4 pt-4 border-t border-slate-700/50 space-y-2">
                    <div className="flex justify-between text-sm">
                        <span className="text-slate-400">{t.quote.materialCost || 'Material Cost'}</span>
                        <span className="text-white">${Math.round(totalCost)}</span>
                    </div>
                    {laborCost > 0 && (
                        <div className="flex justify-between text-sm">
                            <span className="text-slate-400">{t.quote.laborCost || 'Installation'}</span>
                            <span className="text-white">${laborCost}</span>
                        </div>
                    )}
                    {laborCost > 0 && (
                        <div className="flex justify-between text-sm text-slate-500">
                            <span>{t.quote.wasteEstimate || 'Waste/Cut'}</span>
                            <span>${Math.round(totalCost * wasteFactor)}</span>
                        </div>
                    )}
                </div>

                {/* Manual Cost Toggle */}
                <div className="mt-4 no-print">
                    <div className="flex items-center gap-2 mb-2">
                        <input 
                            type="checkbox" 
                            checked={useManualCost}
                            onChange={(e) => setUseManualCost(e.target.checked)}
                            className="rounded"
                        />
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-widest cursor-pointer">
                            {lang === 'es' ? 'Ingresar manualmente' : 'Manual input'}
                        </label>
                    </div>
                </div>

                <div className="mt-6 pt-6 border-t-2 border-slate-800 print:border-black flex justify-between items-center bg-slate-900/50 print:bg-slate-100 -mx-6 -mb-6 p-6 rounded-b-lg">
                    <span className="font-bold text-slate-300 print:text-black uppercase tracking-widest">{laborCost > 0 ? t.quote.totalCost || 'Total Cost' : t.quote.cost}</span>
                    {useManualCost ? (
                        <div className="flex items-center gap-2">
                            <span className="text-2xl font-black text-slate-400">$</span>
                            <input 
                                type="number"
                                value={manualTotalCost}
                                onChange={(e) => setManualTotalCost(parseFloat(e.target.value) || 0)}
                                className="bg-transparent text-3xl font-black text-green-500 print:text-black w-40 text-right focus:outline-none border-b border-slate-600 print:border-none focus:border-green-400"
                                placeholder={lang === 'es' ? 'Ingrese costo...' : 'Enter cost...'}
                                step="0.01"
                            />
                        </div>
                    ) : (
                        <span className="text-3xl font-black text-green-500 print:text-black">${Math.round(displayCost)}</span>
                    )}
                </div>
            </div>
        </section>

        {/* Contractor (No Print) */}
        <div className="no-print space-y-4">
            <div className="bg-slate-800/40 p-5 rounded-xl border border-slate-700 space-y-4">
                <h4 className="text-xs font-black text-blue-400 uppercase tracking-widest flex items-center gap-2">
                    <span>🇨🇴</span>
                    <span>{lang === 'es' ? 'Dirección del Proyecto en Colombia' : 'Colombia Project Address'}</span>
                </h4>
                <div>
                    <input 
                        type="text"
                        value={userAddress}
                        onChange={(e) => setUserAddress(e.target.value)}
                        onBlur={(e) => handleAddressChange(e.target.value)}
                        placeholder={lang === 'es' ? 'Ej: Calle 100 # 15-30, Bogotá o El Poblado, Medellín' : 'e.g., Calle 100 # 15-30, Bogota or El Poblado, Medellin'}
                        className="w-full bg-black border border-slate-700 p-3 text-white rounded-xl text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-all font-semibold"
                    />
                    {geocodedLocation && (
                        <p className="text-[10px] text-green-400 mt-1.5 font-bold flex items-center gap-1.5 animate-pulse">
                            <span>✅</span>
                            <span>{lang === 'es' ? `Geolocalizado en ${geocodedLocation.city} (Coordenadas aproximadas)` : `Geolocalized in ${geocodedLocation.city} (Approximate coordinates)`}</span>
                        </p>
                    )}
                </div>

                <div className="border-t border-slate-700/50 pt-4">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">{t.quote.assignContractor}</label>
                    <select 
                        value={selectedContractor}
                        onChange={(e) => { setSelectedContractor(e.target.value); setManualLaborOverride(false); }}
                        className="w-full bg-black border border-slate-700 p-3 text-white rounded-xl text-base md:text-sm font-semibold focus:outline-none focus:border-blue-500 transition-all"
                    >
                        <option value="">{t.quote.selectContractor}</option>
                        {sortedContractors.map(c => {
                            const distStr = c.distance_km !== undefined && c.distance_km !== null ? `[${c.distance_km.toFixed(1)} km] ` : '';
                            return (
                                <option key={c.id} value={c.id}>
                                    {distStr}{c.name} - {c.region} {c.laborRatePerSqm ? `($${c.laborRatePerSqm}/m²)` : ''}
                                </option>
                            );
                        })}
                    </select>
                </div>
            </div>
            
            {selectedContractor && (
                <div className="bg-slate-800 p-5 rounded-xl border border-slate-700 space-y-4 animate-fadeIn">
                    <div className="flex justify-between items-start">
                        <div>
                            <div className="text-sm font-black text-white uppercase tracking-tight leading-none">
                                {selectedContractorData?.name}
                            </div>
                            <div className="text-xs text-blue-400 font-semibold mt-2.5">
                                📍 {selectedContractorData?.region}
                            </div>
                        </div>
                        {selectedContractorData && (selectedContractorData as any).distance_km !== undefined && (selectedContractorData as any).distance_km !== null && (
                            <div className="bg-blue-600/20 border border-blue-500 text-blue-400 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider">
                                🚗 {(selectedContractorData as any).distance_km.toFixed(1)} km
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-semibold text-slate-400 border-t border-slate-700/50 pt-4">
                        <div>
                            <span className="text-slate-500 uppercase text-[9px] tracking-wider block mb-0.5">Email</span> 
                            <span className="text-slate-300 font-mono">{selectedContractorData?.email || 'N/A'}</span>
                        </div>
                        <div>
                            <span className="text-slate-500 uppercase text-[9px] tracking-wider block mb-0.5">{lang === 'es' ? 'Teléfono' : 'Phone'}</span> 
                            <span className="text-slate-300">{selectedContractorData?.phone || 'N/A'}</span>
                        </div>
                        <div className="md:col-span-2">
                            <span className="text-slate-500 uppercase text-[9px] tracking-wider block mb-0.5">{lang === 'es' ? 'Dirección' : 'Address'}</span> 
                            <span className="text-slate-300">{selectedContractorData?.address || 'N/A'}</span>
                        </div>
                    </div>

                    <div className="flex items-center justify-between border-t border-slate-700/50 pt-4">
                        <label className="text-xs font-bold text-slate-400 uppercase">{t.quote.laborCost || 'Installation Cost'}</label>
                        <label className="flex items-center gap-2 text-xs text-slate-400">
                            <input 
                                type="checkbox" 
                                checked={manualLaborOverride}
                                onChange={(e) => setManualLaborOverride(e.target.checked)}
                                className="rounded bg-black border-slate-700 text-blue-600 focus:ring-0 focus:ring-offset-0"
                            />
                            {lang === 'es' ? 'Ingresar manualmente' : 'Manual input'}
                        </label>
                    </div>
                    {manualLaborOverride ? (
                        <input 
                            type="number"
                            value={laborCost}
                            onChange={(e) => setLaborCost(parseFloat(e.target.value) || 0)}
                            className="w-full bg-black border border-slate-600 p-2.5 text-white rounded-lg focus:outline-none focus:border-blue-500 transition-all font-mono"
                            placeholder={lang === 'es' ? 'Costo de instalación...' : 'Installation cost...'}
                        />
                    ) : (
                        <div className="text-2xl font-black text-green-400 font-mono">${laborCost}</div>
                    )}
                </div>
            )}

            {/* Nearby Installers Marketplace */}
            {geocodedLocation && (
                <div className="bg-slate-800/40 p-5 rounded-xl border border-slate-700/50 space-y-4 animate-fadeIn">
                    <div className="flex justify-between items-center">
                        <h4 className="text-[10px] font-black text-blue-400 uppercase tracking-widest">
                            {lang === 'es' ? 'Instaladores por Proximidad' : 'Installers by Proximity'}
                        </h4>
                    </div>

                    <div className="space-y-3">
                        {sortedContractors.map((inst: any) => (
                            <div 
                                key={inst.id} 
                                onClick={() => {
                                    setSelectedContractor(inst.id);
                                    setManualLaborOverride(false);
                                }}
                                className={`flex justify-between items-center p-4 rounded-2xl border cursor-pointer transition-all ${selectedContractor === inst.id ? 'bg-blue-600/20 border-blue-500 shadow-md shadow-blue-500/5' : 'bg-black border-slate-800 hover:border-slate-600'}`}
                            >
                                <div>
                                    <div className="text-xs font-bold text-white">{inst.name}</div>
                                    <div className="text-[9px] text-slate-500 uppercase font-black tracking-wider mt-1">📍 {inst.region}</div>
                                    <div className="text-[10px] text-slate-400 mt-1.5 font-semibold">{inst.address}</div>
                                </div>
                                <div className="text-right pl-4">
                                    <div className="text-[11px] font-black text-blue-400 font-mono">
                                        {inst.distance_km !== null && inst.distance_km !== undefined ? `${inst.distance_km.toFixed(1)} km` : 'N/A'}
                                    </div>
                                    <div className="text-[9px] text-slate-500 font-semibold">{lang === 'es' ? 'Distancia' : 'Distance'}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>

        {/* Print Only Footer */}
        <div className="hidden print:block mt-10">
            {selectedContractorData && (
                 <div className="hidden print:block mt-8 pt-6 border-t border-slate-200">
                    <h4 className="font-bold uppercase tracking-widest text-black mb-3">{t.quote.assignedInstaller}</h4>
                    <div className="grid grid-cols-2 gap-4 text-sm text-black border border-slate-200 p-4">
                        <div><span className="block text-[10px] uppercase text-slate-500">{t.quote.name}</span><span className="font-bold">{selectedContractorData.name}</span></div>
                        <div><span className="block text-[10px] uppercase text-slate-500">{t.quote.region}</span><span className="font-bold">{selectedContractorData.region}</span></div>
                        <div><span className="block text-[10px] uppercase text-slate-500">{t.quote.phone}</span><span className="font-bold">{selectedContractorData.phone}</span></div>
                        <div><span className="block text-[10px] uppercase text-slate-500">{t.quote.email}</span><span className="font-bold">{selectedContractorData.email}</span></div>
                    </div>
                 </div>
            )}
            <div className="text-center mt-10 pt-4 border-t border-slate-200">
                <p className="text-sm font-bold uppercase tracking-widest text-black">{t.quote.footer}</p>
            </div>
        </div>
      </div>

      {/* Action Footer - Stacked on Mobile */}
      <div className="p-4 md:p-6 bg-black border-t border-slate-800 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 no-print">
        <Button variant="secondary" onClick={onBack} className="uppercase text-xs tracking-wider py-3 md:py-2">{t.common.back}</Button>
        <Button 
            variant="secondary" 
            onClick={handleSendEmail} 
            isLoading={emailStatus === 'sending'}
            className={`uppercase text-xs tracking-wider py-3 md:py-2 ${emailStatus === 'sent' ? 'bg-green-600 border-green-500 text-white' : emailStatus === 'error' ? 'bg-red-600 border-red-500 text-white' : ''}`}
        >
            {emailStatus === 'sending' ? (lang === 'es' ? 'Enviando...' : 'Sending...') : 
             emailStatus === 'sent' ? (lang === 'es' ? 'Enviado!' : 'Sent!') : 
             emailStatus === 'error' ? (lang === 'es' ? 'Error' : 'Error') : 
             t.common.email}
        </Button>
        <Button 
            onClick={handleAddToCart}
            className={`uppercase text-xs tracking-wider font-bold py-3 md:py-2 ${addedToCart ? "bg-green-600" : "bg-blue-600"}`}
        >
            {addedToCart ? "Added!" : t.quote.addToCart}
        </Button>
        <Button 
            variant="primary" 
            onClick={handleDownloadPDF}
            className="uppercase text-xs tracking-wider font-bold bg-white text-black hover:bg-slate-200 py-3 md:py-2" 
        >
            PDF
        </Button>
        {onNewQuote && (
            <Button 
                variant="ghost" 
                onClick={onNewQuote}
                className="uppercase text-xs tracking-wider text-slate-400 hover:text-white py-3 md:py-2 hidden sm:block" 
            >
                New
            </Button>
        )}
      </div>
    </div>
  );
};