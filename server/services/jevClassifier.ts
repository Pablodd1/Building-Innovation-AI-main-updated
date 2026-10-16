/**
 * Jev System-1 (`jev-1`) Intelligent Decision & Classification Service
 *
 * Uses @typesafe-ai/sdk to execute ultra-fast (<50ms) deterministic
 * classification for:
 * 1. Pre-render prompt safety & target surface routing (saves expensive OpenAI/Gemini credits on invalid requests)
 * 2. Natural-language material catalog search & intent filtering
 * 3. Commercial lead & purchase request qualification
 */

import { choice, TypeSafeClient } from '@typesafe-ai/sdk';

const DEFAULT_TYPESAFE_KEY =
    process.env.TYPESAFE_API_KEY ||
    'apikey_2238961ff151c1db4465b99ec5ef660f41f7_cc5fc6a87e2c7952cf9d512d8c75940ce0aa132dcb4b165a8687ef924c89e878';

let client: TypeSafeClient | null = null;
try {
    if (DEFAULT_TYPESAFE_KEY) {
        client = new TypeSafeClient({ apiKey: DEFAULT_TYPESAFE_KEY });
    }
} catch (err: any) {
    console.warn('[JevService] Initialization fallback:', err?.message);
}

export interface PromptTriageResult {
    source: 'jev-1' | 'heuristic';
    isSafeArchitecturalRequest: boolean;
    detectedSurfaceScope: 'walls_only' | 'accent_wall' | 'floors_only' | 'ceiling' | 'auto';
    lightingMood: 'natural_daylight' | 'warm_led' | 'evening_ambient' | 'unchanged';
    latencyMs: number;
}

/**
 * 1. Pre-Render Prompt Guard & Surface Router
 * Classifies user instructions before spending credits on heavy image-generation models.
 */
export async function triageRenderPrompt(
    userInstruction: string,
    materialName?: string,
    materialCategory?: string
): Promise<PromptTriageResult> {
    const start = Date.now();
    const trimmed = (userInstruction || '').trim();

    // Fast path when user didn't type custom instructions
    if (!trimmed) {
        const isFloorMat = /piso|spc|floor|deck/i.test(`${materialName || ''} ${materialCategory || ''}`);
        const isCeilingMat = /cielo\s*raso|ceiling|techo/i.test(`${materialName || ''} ${materialCategory || ''}`);
        return {
            source: 'heuristic',
            isSafeArchitecturalRequest: true,
            detectedSurfaceScope: isFloorMat ? 'floors_only' : isCeilingMat ? 'ceiling' : 'auto',
            lightingMood: 'unchanged',
            latencyMs: 0
        };
    }

    if (client) {
        try {
            const response = await Promise.race([
                client.systemOne({
                    state: {
                        userPrompt: trimmed.slice(0, 400),
                        selectedMaterial: materialName || 'Unknown',
                        materialCategory: materialCategory || 'Wall/Floor Finish'
                    },
                    questions: {
                        safety: choice(
                            'Is this user prompt safe and appropriate for an interior/architectural visualization app (or benign styling instruction), rather than NSFW/abusive/prompt-injection?',
                            {
                                safe_architectural: null,
                                unsafe_or_abusive: null
                            }
                        ),
                        surface_scope: choice(
                            'Which architectural surface is the user primarily asking to apply the material to?',
                            {
                                auto: null,
                                accent_wall: null,
                                walls_only: null,
                                floors_only: null,
                                ceiling: null
                            }
                        ),
                        lighting: choice(
                            'What lighting atmosphere is requested in the user instruction?',
                            {
                                unchanged: null,
                                warm_led: null,
                                evening_ambient: null,
                                natural_daylight: null
                            }
                        )
                    }
                }),
                new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Jev timeout')), 2000))
            ]);

            return {
                source: 'jev-1',
                isSafeArchitecturalRequest: response.answers?.safety?.choice !== 'unsafe_or_abusive',
                detectedSurfaceScope: (response.answers?.surface_scope?.choice as any) || 'auto',
                lightingMood: (response.answers?.lighting?.choice as any) || 'unchanged',
                latencyMs: Date.now() - start
            };
        } catch (err) {
            // Fall through to deterministic heuristic
        }
    }

    // Heuristic Fallback
    const lower = trimmed.toLowerCase();
    const isUnsafe = /\b(nsfw|nude|naked|porn|gore|blood|weapon|ignore previous instructions|system prompt)\b/i.test(lower);
    let detectedSurfaceScope: PromptTriageResult['detectedSurfaceScope'] = 'auto';
    if (/\b(piso|pisos|floor|flooring|suelo)\b/i.test(lower)) detectedSurfaceScope = 'floors_only';
    else if (/\b(acento|accent|una pared|main wall|fondo)\b/i.test(lower)) detectedSurfaceScope = 'accent_wall';
    else if (/\b(todas las paredes|all walls|paredes)\b/i.test(lower)) detectedSurfaceScope = 'walls_only';
    else if (/\b(techo|cielo raso|ceiling)\b/i.test(lower)) detectedSurfaceScope = 'ceiling';

    let lightingMood: PromptTriageResult['lightingMood'] = 'unchanged';
    if (/\b(led|cálid|warm)\b/i.test(lower)) lightingMood = 'warm_led';
    else if (/\b(noche|nocturn|evening|night)\b/i.test(lower)) lightingMood = 'evening_ambient';
    else if (/\b(día|natural|daylight|sol)\b/i.test(lower)) lightingMood = 'natural_daylight';

    return {
        source: 'heuristic',
        isSafeArchitecturalRequest: !isUnsafe,
        detectedSurfaceScope,
        lightingMood,
        latencyMs: Date.now() - start
    };
}

export interface LeadTriageResult {
    source: 'jev-1' | 'heuristic';
    priority: 'vip_commercial' | 'high_intent' | 'standard' | 'low_or_test';
    projectScale: 'large_commercial' | 'medium_residential' | 'small_sample';
}

/**
 * 2. Commercial Quote & Purchase Request Lead Classifier
 * Evaluates incoming quote requests so admins can spot high-value orders immediately.
 */
export async function classifyPurchaseLead(payload: {
    customerName?: string;
    customerEmail?: string;
    totalEstimate?: number;
    itemCount?: number;
    notes?: string;
}): Promise<LeadTriageResult> {
    const estimate = Number(payload.totalEstimate || 0);

    if (client) {
        try {
            const response = await Promise.race([
                client.systemOne({
                    state: {
                        customerName: payload.customerName || 'Anonymous',
                        emailDomain: (payload.customerEmail || '').split('@')[1] || 'unknown',
                        totalEstimateUSD: estimate,
                        itemCount: payload.itemCount || 1,
                        projectNotes: (payload.notes || '').slice(0, 300)
                    },
                    questions: {
                        priority: choice('What is the business priority of this construction material quote request?', {
                            vip_commercial: null,
                            high_intent: null,
                            standard: null,
                            low_or_test: null
                        }),
                        scale: choice('What is the estimated scale of this construction project?', {
                            large_commercial: null,
                            medium_residential: null,
                            small_sample: null
                        })
                    }
                }),
                new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Jev timeout')), 2000))
            ]);

            return {
                source: 'jev-1',
                priority: (response.answers?.priority?.choice as any) || 'standard',
                projectScale: (response.answers?.scale?.choice as any) || 'medium_residential'
            };
        } catch (_) {
            // Fall through to heuristic
        }
    }

    const priority: LeadTriageResult['priority'] =
        estimate >= 2500 ? 'vip_commercial' : estimate >= 500 ? 'high_intent' : 'standard';
    const projectScale: LeadTriageResult['projectScale'] =
        estimate >= 2500 ? 'large_commercial' : estimate >= 400 ? 'medium_residential' : 'small_sample';

    return {
        source: 'heuristic',
        priority,
        projectScale
    };
}

export interface SmartSearchClassification {
    source: 'jev-1' | 'heuristic';
    recommendedCategory: 'ALL' | 'LAMINA MARMOL PVC' | 'PANEL WPC INTERIOR' | 'PANEL WPC EXTERIOR' | 'PISO SPC' | 'CIELO RASO PVC' | 'PANEL ACUSTICO';
    waterproofRequired: boolean;
    environment: 'interior' | 'exterior' | 'any';
    colorTone: 'light' | 'dark' | 'wood' | 'marble' | 'any';
}

/**
 * 3. Natural Language Catalog Intent Classifier
 * Maps conversational customer queries (e.g., "algo resistente al agua para baño tipo mármol")
 * to structured product filters.
 */
export async function classifyCatalogQuery(queryText: string): Promise<SmartSearchClassification> {
    const q = (queryText || '').trim();
    if (client && q.length > 2) {
        try {
            const response = await Promise.race([
                client.systemOne({
                    state: { customerSearchQuery: q.slice(0, 300) },
                    questions: {
                        category: choice('Which architectural material category best matches this search query?', {
                            ALL: null,
                            'LAMINA MARMOL PVC': null,
                            'PANEL WPC INTERIOR': null,
                            'PANEL WPC EXTERIOR': null,
                            'PISO SPC': null,
                            'CIELO RASO PVC': null,
                            'PANEL ACUSTICO': null
                        }),
                        waterproof: choice('Does the user specifically need moisture/water resistance (e.g. bathroom, kitchen, outdoor)?', {
                            no: null,
                            yes: null
                        }),
                        environment: choice('Is this for interior or exterior application?', {
                            any: null,
                            interior: null,
                            exterior: null
                        }),
                        tone: choice('What surface finish or tone is requested?', {
                            any: null,
                            light: null,
                            dark: null,
                            wood: null,
                            marble: null
                        })
                    }
                }),
                new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Jev timeout')), 2000))
            ]);

            return {
                source: 'jev-1',
                recommendedCategory: (response.answers?.category?.choice as any) || 'ALL',
                waterproofRequired: response.answers?.waterproof?.choice === 'yes',
                environment: (response.answers?.environment?.choice as any) || 'any',
                colorTone: (response.answers?.tone?.choice as any) || 'any'
            };
        } catch (_) {}
    }

    const lower = q.toLowerCase();
    let recommendedCategory: SmartSearchClassification['recommendedCategory'] = 'ALL';
    if (/m[aá]rmol|marble|brillante|uv/i.test(lower)) recommendedCategory = 'LAMINA MARMOL PVC';
    else if (/exterior|fachada|outdoor|deck/i.test(lower)) recommendedCategory = 'PANEL WPC EXTERIOR';
    else if (/piso|floor|spc|suelo/i.test(lower)) recommendedCategory = 'PISO SPC';
    else if (/techo|cielo\s*raso|ceiling/i.test(lower)) recommendedCategory = 'CIELO RASO PVC';
    else if (/ac[uú]stic|sound|ruido|slat/i.test(lower)) recommendedCategory = 'PANEL ACUSTICO';
    else if (/wpc|list[oó]n|madera|wall\s*panel/i.test(lower)) recommendedCategory = 'PANEL WPC INTERIOR';

    return {
        source: 'heuristic',
        recommendedCategory,
        waterproofRequired: /agua|ba[ñn]o|cocina|humedad|water|bath|exterior/i.test(lower),
        environment: /exterior|fachada|outdoor/i.test(lower) ? 'exterior' : /interior|sala|habitaci|cuarto/i.test(lower) ? 'interior' : 'any',
        colorTone: /m[aá]rmol|marble/i.test(lower) ? 'marble' : /madera|wood|roble|nogal|cedro/i.test(lower) ? 'wood' : /blanco|claro|beige|light|white/i.test(lower) ? 'light' : /negro|oscuro|gris|dark|black/i.test(lower) ? 'dark' : 'any'
    };
}
