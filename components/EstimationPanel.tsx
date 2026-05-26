import React, { useState, useMemo, useEffect } from 'react';
import { Material, Contractor, Language, RegionUnit } from '../types';

interface EstimationPanelProps {
    material: Material;
    onBack: () => void;
    onAddToCart: () => void;
    onNewQuote: () => void;
    contractors: Contractor[];
    lang: Language;
    unitSystem: RegionUnit;
    userEmail: string;
    userName: string;
}

// Conversion helpers
const CM_TO_INCH = 0.393701;
const CM_TO_FT = 0.0328084;
const SQM_TO_SQFT = 10.7639;

interface UnitLabels {
    cm: string;
    m: string;
    m2: string;
    ft: string;
    inch: string;
    ft2: string;
}

export const EstimationPanel: React.FC<EstimationPanelProps> = ({
    material,
    onBack,
    onAddToCart,
    onNewQuote,
    contractors,
    lang,
    unitSystem,
    userEmail,
    userName,
}) => {
    const isLatam = unitSystem === 'latam';
    const t = isLatam
        ? { cm: 'cm', m: 'm', m2: 'm²', ft: 'ft', inch: 'in', ft2: 'ft²' }
        : { cm: 'cm', m: 'm', m2: 'm²', ft: 'ft', inch: 'in', ft2: 'ft²' };

    // Material dimensions in cm (always stored metric)
    const matWidth = material.dimensions?.width || 30;
    const matLength = material.dimensions?.length || 30;
    const matThickness = material.dimensions?.thickness || 0;

    // Convert material dims to display units
    const displayMatWidth = isLatam ? matWidth : Math.round(matWidth * CM_TO_INCH * 10) / 10;
    const displayMatLength = isLatam ? matLength : Math.round(matLength * CM_TO_INCH * 10) / 10;
    const dimUnit = isLatam ? 'cm' : 'in';

    // Room dimension inputs (in display units)
    const [roomWidth, setRoomWidth] = useState<string>('');
    const [roomHeight, setRoomHeight] = useState<string>('');
    const [wastePct, setWastePct] = useState<number>(
        material.specs?.recommendedWaste
            ? Math.round(material.specs.recommendedWaste * 100)
            : 5
    );
    const [selectedContractor, setSelectedContractor] = useState<string>('');
    const [laborOverride, setLaborOverride] = useState<string>('');

    // Convert room dims to cm for calculation
    const roomW_cm = parseFloat(roomWidth) || 0;
    const roomH_cm = parseFloat(roomHeight) || 0;
    const roomW = isLatam ? roomW_cm : roomW_cm / CM_TO_INCH;
    const roomH = isLatam ? roomH_cm : roomH_cm / CM_TO_INCH;

    // Area in m²
    const areaM2 = (roomW * roomH) / 10000;
    const areaDisplay = isLatam ? areaM2 : areaM2 * SQM_TO_SQFT;
    const areaUnit = isLatam ? 'm²' : 'ft²';

    // Panel area in cm²
    const panelAreaCm2 = matWidth * matLength;
    const panelAreaM2 = panelAreaCm2 / 10000;

    // Panels needed
    const exactPanels = areaM2 > 0 ? areaM2 / panelAreaM2 : 0;
    const wasteMultiplier = 1 + (wastePct / 100);
    const panelsWithWaste = Math.ceil(exactPanels * wasteMultiplier);
    const wastePanels = Math.max(0, panelsWithWaste - Math.ceil(exactPanels));

    // Pricing
    const unitPrice = material.pricing?.pricePerUnit || 0;
    const unitLabel = material.pricing?.unitLabel || (lang === 'es' ? 'Unidad' : 'Unit');
    const currency = material.pricing?.currency || 'USD';

    const materialCost = panelsWithWaste * unitPrice;
    const wasteCost = wastePanels * unitPrice;

    // Contractor labor
    const contractor = contractors.find(c => c.id === selectedContractor);
    const laborRatePerSqm = contractor?.laborRatePerSqm || parseFloat(laborOverride) || 0;
    const laborCost = laborRatePerSqm > 0 ? areaM2 * laborRatePerSqm : 0;

    const subtotal = materialCost + wasteCost;
    const total = subtotal + laborCost;

    // Format currency
    const fmt = (n: number) =>
        new Intl.NumberFormat(lang === 'es' ? 'es-CO' : 'en-US', {
            style: 'currency',
            currency,
            minimumFractionDigits: 2,
        }).format(n);

    // Format number
    const fmtNum = (n: number, decimals = 2) =>
        isLatam
            ? n.toLocaleString('es-CO', { maximumFractionDigits: decimals })
            : n.toLocaleString('en-US', { maximumFractionDigits: decimals });

    const specLabel = lang === 'es'
        ? {
            material: 'Material',
            refCode: 'Referencia',
            category: 'Categoría',
            dimensions: 'Dimensiones',
            thickness: 'Grosor',
            finish: 'Acabado',
            installation: 'Tipo de Instalación',
            patternRepeat: 'Repetición de Patrón',
            waste: 'Factor de Desperdicio',
            roomDimensions: 'Dimensiones del Espacio',
            width: 'Ancho',
            height: 'Altura',
            area: 'Área',
            panelsNeeded: 'Paneles Necesarios',
            exactCalculation: 'Cálculo Exacto',
            panelsWithWaste: 'Con Desperdicio',
            wastePanels: 'Paneles de Desperdicio',
            estimateBreakdown: 'Desglose del Presupuesto',
            materialCost: 'Costo de Material',
            wasteCost: 'Costo de Desperdicio',
            subtotal: 'Subtotal',
            laborCost: 'Costo de Instalación',
            total: 'Total Estimado',
            perUnit: 'por unidad',
            addToCart: 'Añadir al Carrito',
            emailQuote: 'Solicitar Cotización',
            newQuote: 'Nueva Cotización',
            back: 'Volver',
            assignContractor: 'Asignar Instalador',
            selectContractor: 'Seleccionar instalador...',
            noContractor: 'Sin instalador',
            manualLabor: 'o ingresa costo manual (por m²):',
            units: 'unidades',
            panels: 'paneles',
        }
        : {
            material: 'Material',
            refCode: 'Reference',
            category: 'Category',
            dimensions: 'Dimensions',
            thickness: 'Thickness',
            finish: 'Finish',
            installation: 'Installation Type',
            patternRepeat: 'Pattern Repeat',
            waste: 'Waste Factor',
            roomDimensions: 'Room Dimensions',
            width: 'Width',
            height: 'Height',
            area: 'Area',
            panelsNeeded: 'Panels Needed',
            exactCalculation: 'Exact Calculation',
            panelsWithWaste: 'With Waste',
            wastePanels: 'Waste Panels',
            estimateBreakdown: 'Estimate Breakdown',
            materialCost: 'Material Cost',
            wasteCost: 'Waste Cost',
            subtotal: 'Subtotal',
            laborCost: 'Installation Cost',
            total: 'Total Estimate',
            perUnit: 'per unit',
            addToCart: 'Add to Cart',
            emailQuote: 'Request Quote',
            newQuote: 'New Quote',
            back: 'Back',
            assignContractor: 'Assign Installer',
            selectContractor: 'Select installer...',
            noContractor: 'No installer',
            manualLabor: 'or enter manual rate (per m²):',
            units: 'units',
            panels: 'panels',
        };

    const subst = material.subcategory || material.category || '';

    return (
        <div className="flex flex-col gap-4 max-w-2xl mx-auto pb-8">
            {/* ── Header ── */}
            <div className="flex items-center gap-4">
                <button
                    onClick={onBack}
                    className="text-slate-400 hover:text-white transition-colors p-2 -ml-2"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                </button>
                <div>
                    <h1 className="text-xl font-bold text-white">{material.name}</h1>
                    <p className="text-sm text-slate-400">
                        {material.refCode} · {subst}
                    </p>
                </div>
            </div>

            {/* ── Material Specs Card ── */}
            <div className="bg-slate-800/80 border border-slate-700 rounded-2xl overflow-hidden">
                {/* Image */}
                {material.imageUrl && (
                    <div className="aspect-video bg-slate-900 overflow-hidden">
                        <img
                            src={material.imageUrl}
                            alt={material.name}
                            className="w-full h-full object-cover"
                        />
                    </div>
                )}
                <div className="p-4 grid grid-cols-2 gap-3 text-sm">
                    {/* Dimensions */}
                    <div>
                        <span className="text-slate-500 block text-xs uppercase tracking-wider mb-0.5">
                            {specLabel.dimensions}
                        </span>
                        <span className="text-white font-medium">
                            {fmtNum(displayMatWidth, 1)} × {fmtNum(displayMatLength, 1)} {dimUnit}
                        </span>
                    </div>
                    {matThickness > 0 && (
                        <div>
                            <span className="text-slate-500 block text-xs uppercase tracking-wider mb-0.5">
                                {specLabel.thickness}
                            </span>
                            <span className="text-white font-medium">
                                {matThickness} mm
                            </span>
                        </div>
                    )}
                    {material.specs?.finish && (
                        <div>
                            <span className="text-slate-500 block text-xs uppercase tracking-wider mb-0.5">
                                {specLabel.finish}
                            </span>
                            <span className="text-white font-medium">{material.specs.finish}</span>
                        </div>
                    )}
                    {material.specs?.installationType && (
                        <div>
                            <span className="text-slate-500 block text-xs uppercase tracking-wider mb-0.5">
                                {specLabel.installation}
                            </span>
                            <span className="text-white font-medium capitalize">
                                {material.specs.installationType.toLowerCase()}
                            </span>
                        </div>
                    )}
                    {material.specs?.patternRepeat && material.specs.patternRepeat > 0 && (
                        <div>
                            <span className="text-slate-500 block text-xs uppercase tracking-wider mb-0.5">
                                {specLabel.patternRepeat}
                            </span>
                            <span className="text-white font-medium">
                                {material.specs.patternRepeat} cm
                            </span>
                        </div>
                    )}
                    <div>
                        <span className="text-slate-500 block text-xs uppercase tracking-wider mb-0.5">
                            {specLabel.waste}
                        </span>
                        <span className="text-amber-400 font-medium">{wastePct}%</span>
                    </div>
                    <div>
                        <span className="text-slate-500 block text-xs uppercase tracking-wider mb-0.5">
                            {lang === 'es' ? 'Precio' : 'Price'}
                        </span>
                        <span className="text-green-400 font-medium">
                            {fmt(unitPrice)} <span className="text-slate-500 text-xs">/ {unitLabel}</span>
                        </span>
                    </div>
                </div>
            </div>

            {/* ── Room Dimensions Input ── */}
            <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-4">
                <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">
                    {specLabel.roomDimensions}
                </h2>
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="block text-xs text-slate-500 mb-1">{specLabel.width} ({dimUnit})</label>
                        <input
                            type="number"
                            value={roomWidth}
                            onChange={(e) => setRoomWidth(e.target.value)}
                            placeholder={isLatam ? 'ej. 400' : 'ex. 157'}
                            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 placeholder:text-slate-600"
                            min="0"
                            step="0.1"
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-slate-500 mb-1">{specLabel.height} ({dimUnit})</label>
                        <input
                            type="number"
                            value={roomHeight}
                            onChange={(e) => setRoomHeight(e.target.value)}
                            placeholder={isLatam ? 'ej. 270' : 'ex. 106'}
                            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 placeholder:text-slate-600"
                            min="0"
                            step="0.1"
                        />
                    </div>
                </div>
                {/* Waste factor slider */}
                <div className="mt-3">
                    <div className="flex justify-between items-center mb-1">
                        <label className="text-xs text-slate-500">{specLabel.waste}</label>
                        <span className="text-sm text-amber-400 font-medium">{wastePct}%</span>
                    </div>
                    <input
                        type="range"
                        min="0"
                        max="30"
                        value={wastePct}
                        onChange={(e) => setWastePct(parseInt(e.target.value))}
                        className="w-full accent-amber-500"
                    />
                    <div className="flex justify-between text-[10px] text-slate-600">
                        <span>0%</span>
                        <span>15%</span>
                        <span>30%</span>
                    </div>
                </div>
            </div>

            {/* ── Panel Calculation ── */}
            {areaM2 > 0 && (
                <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-4">
                    <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">
                        {specLabel.panelsNeeded}
                    </h2>
                    <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                            <span className="text-slate-400">{specLabel.area}</span>
                            <span className="text-white font-medium">
                                {fmtNum(areaDisplay, 2)} {areaUnit}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-slate-400">{specLabel.exactCalculation}</span>
                            <span className="text-white">
                                {fmtNum(exactPanels, 1)} {specLabel.panels.toLowerCase()}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-slate-400">{specLabel.panelsWithWaste}</span>
                            <span className="text-amber-400 font-bold">
                                {panelsWithWaste} {specLabel.panels.toLowerCase()}
                            </span>
                        </div>
                        {wastePanels > 0 && (
                            <div className="flex justify-between text-xs">
                                <span className="text-slate-500">{specLabel.wastePanels}</span>
                                <span className="text-slate-500">{wastePanels} {specLabel.panels.toLowerCase()}</span>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── Cost Breakdown ── */}
            {areaM2 > 0 && (
                <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-4">
                    <h2 className="text-sm font-semibold text-green-400 uppercase tracking-wider mb-3">
                        {specLabel.estimateBreakdown}
                    </h2>
                    <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                            <span className="text-slate-400">
                                {specLabel.materialCost} ({panelsWithWaste} {specLabel.panels.toLowerCase()} × {fmt(unitPrice)})
                            </span>
                            <span className="text-white">{fmt(materialCost)}</span>
                        </div>
                        {wasteCost > 0 && (
                            <div className="flex justify-between text-xs">
                                <span className="text-slate-500">
                                    {specLabel.wasteCost} ({wastePanels} {specLabel.panels.toLowerCase()})
                                </span>
                                <span className="text-amber-400">{fmt(wasteCost)}</span>
                            </div>
                        )}
                        <hr className="border-slate-700" />
                        <div className="flex justify-between font-semibold">
                            <span className="text-slate-300">{specLabel.subtotal}</span>
                            <span className="text-white">{fmt(subtotal)}</span>
                        </div>

                        {/* Contractor / Labor */}
                        <div className="mt-3 pt-3 border-t border-slate-700">
                            <label className="text-xs text-slate-500 block mb-1">{specLabel.assignContractor}</label>
                            <select
                                value={selectedContractor}
                                onChange={(e) => setSelectedContractor(e.target.value)}
                                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                            >
                                <option value="">{specLabel.noContractor}</option>
                                {contractors.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.name} {c.laborRatePerSqm ? `(${fmt(c.laborRatePerSqm)}/m²)` : ''}
                                    </option>
                                ))}
                            </select>
                            {!selectedContractor && (
                                <div className="mt-2">
                                    <label className="text-xs text-slate-500 block mb-1">{specLabel.manualLabor}</label>
                                    <input
                                        type="number"
                                        value={laborOverride}
                                        onChange={(e) => setLaborOverride(e.target.value)}
                                        placeholder="0"
                                        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 placeholder:text-slate-600"
                                        min="0"
                                        step="0.01"
                                    />
                                </div>
                            )}
                        </div>

                        {laborCost > 0 && (
                            <div className="flex justify-between">
                                <span className="text-slate-400">{specLabel.laborCost}</span>
                                <span className="text-white">{fmt(laborCost)}</span>
                            </div>
                        )}

                        <hr className="border-slate-700" />
                        <div className="flex justify-between font-bold text-base">
                            <span className="text-white">{specLabel.total}</span>
                            <span className="text-green-400">{fmt(total)}</span>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Actions ── */}
            <div className="flex flex-col gap-3">
                <button
                    onClick={onAddToCart}
                    disabled={areaM2 <= 0}
                    className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
                    </svg>
                    {specLabel.addToCart}
                </button>
                <div className="flex gap-3">
                    <button
                        onClick={() => {
                            const subject = lang === 'es'
                                ? `Cotización: ${material.name}`
                                : `Quote: ${material.name}`;
                            const body = lang === 'es'
                                ? `Hola,\n\nMe gustaría solicitar una cotización formal para:\n\nMaterial: ${material.name} (${material.refCode})\nDimensiones del espacio: ${fmtNum(roomW_cm, 1)} × ${fmtNum(roomH_cm, 1)} ${isLatam ? 'cm' : 'in'}\nÁrea: ${fmtNum(areaDisplay, 2)} ${areaUnit}\nPaneles necesarios: ${panelsWithWaste}\nCosto estimado: ${fmt(total)}\n\nGracias,\n${userName || ''}`
                                : `Hello,\n\nI would like to request a formal quote for:\n\nMaterial: ${material.name} (${material.refCode})\nRoom Dimensions: ${fmtNum(roomW_cm, 1)} × ${fmtNum(roomH_cm, 1)} ${isLatam ? 'cm' : 'in'}\nArea: ${fmtNum(areaDisplay, 2)} ${areaUnit}\nPanels Needed: ${panelsWithWaste}\nEstimated Cost: ${fmt(total)}\n\nThank you,\n${userName || ''}`;
                            window.location.href = `mailto:${userEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
                        }}
                        disabled={areaM2 <= 0}
                        className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white font-medium rounded-xl transition-colors text-sm"
                    >
                        {specLabel.emailQuote}
                    </button>
                    <button
                        onClick={onNewQuote}
                        className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-xl transition-colors text-sm"
                    >
                        {specLabel.newQuote}
                    </button>
                </div>
                <button
                    onClick={onBack}
                    className="py-2 text-slate-500 hover:text-slate-300 text-sm transition-colors"
                >
                    ← {specLabel.back}
                </button>
            </div>
        </div>
    );
};
