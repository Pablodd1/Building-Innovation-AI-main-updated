
import { Material, Contractor, Language } from './types';

// MATCHING USER CATALOG "ROLLOS ADHESIVOS - PARED MARMOL"
// From PDF Screenshot
// MEDIDAS: ANCHO: 120CM, LARGO: 3MTS

export const MATERIALS: Material[] = [
  // --- FURNITURE (MUEBLES) ---
  {
    id: 'mueble-comedor-petra',
    refCode: '15010101',
    name: 'Mesa de Comedor Petra',
    description: 'Modern dining set featuring a large glass top table with robust concrete bases, accompanied by upholstered grey chairs with dark wood legs.',
    promptModifier: 'modern glass dining table with concrete cylindrical bases, surrounded by grey upholstered contemporary chairs, luxury dining room furniture',
    thumbnailUrl: 'https://images.unsplash.com/photo-1617806118233-18e1de247200?auto=format&fit=crop&w=600&q=80',
    category: 'Muebles',
    usage: 'Furniture',
    dimensions: { width: 220, length: 110, thickness: 75 }, // Approx table size
    pricing: { pricePerUnit: 2400.00, currency: 'USD', unitLabel: 'Set' },
    exampleImageUrl: 'https://images.unsplash.com/photo-1617806118233-18e1de247200?auto=format&fit=crop&w=800&q=80',
    specs: { installationType: 'UNIT' }
  },
  {
    id: 'mueble-sofa-cuero',
    refCode: '15010102',
    name: 'Sofá de Cuero Camel',
    description: 'Premium caramel brown leather sofa, 2-3 seater. Modern design with plush cushioning and sleek profile.',
    promptModifier: 'caramel brown leather sofa, modern italian design, plush cushions, luxury living room furniture',
    thumbnailUrl: 'https://images.unsplash.com/photo-1493663284031-b7e3aefcae8e?auto=format&fit=crop&w=600&q=80',
    category: 'Muebles',
    usage: 'Furniture',
    dimensions: { width: 210, length: 95, thickness: 85 },
    pricing: { pricePerUnit: 1850.00, currency: 'USD', unitLabel: 'Unit' },
    exampleImageUrl: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=800&q=80',
    specs: { installationType: 'UNIT' }
  },
  {
    id: 'mueble-sofa-beige',
    refCode: '15010103',
    name: 'Sofá Moderno Beige',
    description: 'Contemporary beige/cream sofa with clean lines and soft fabric upholstery. Ideal for minimalist interiors.',
    promptModifier: 'cream beige modern sofa, fabric upholstery, minimalist design, soft lighting',
    thumbnailUrl: 'https://images.unsplash.com/photo-1550226891-ef816aed4a98?auto=format&fit=crop&w=600&q=80',
    category: 'Muebles',
    usage: 'Furniture',
    dimensions: { width: 200, length: 90, thickness: 85 },
    pricing: { pricePerUnit: 1450.00, currency: 'USD', unitLabel: 'Unit' },
    exampleImageUrl: 'https://images.unsplash.com/photo-1550226891-ef816aed4a98?auto=format&fit=crop&w=800&q=80',
    specs: { installationType: 'UNIT' }
  },

  // --- WALL ROLLS (MARBLE) ---
  {
    id: 'roll-marmol-gris',
    refCode: '14121301',
    name: 'Pared Mármol Gris',
    description: 'Self-adhesive grey marble wall covering with classic white stone veining. Ideal for modern feature walls.',
    promptModifier: 'install grey marble wall covering, continuous seamless stone texture, luxury grey stone wall, high gloss finish',
    thumbnailUrl: 'https://images.unsplash.com/photo-1615800098779-1be32e60cca3?auto=format&fit=crop&w=600&q=80',
    category: 'Rollos Adhesivos',
    usage: 'Interior',
    dimensions: { width: 120, length: 300, thickness: 2 }, // 120cm x 3m
    pricing: { pricePerUnit: 85.00, currency: 'USD', unitLabel: 'Roll' },
    exampleImageUrl: 'https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=800&q=80',
    specs: { installationType: 'ROLL', patternRepeat: 60, recommendedWaste: 0.10 }
  },
  {
    id: 'roll-marmol-negro',
    refCode: '14121302',
    name: 'Pared Mármol Negro',
    description: 'Dramatic black marble adhesive roll with striking white lightning veins. Creates a bold, sophisticated look.',
    promptModifier: 'install black marble wall covering with sharp white veins, high contrast stone texture, luxury dark interior',
    thumbnailUrl: 'https://images.unsplash.com/photo-1616047006789-b7af5afb8c01?auto=format&fit=crop&w=600&q=80',
    category: 'Rollos Adhesivos',
    usage: 'Interior',
    dimensions: { width: 120, length: 300, thickness: 2 }, // 120cm x 3m
    pricing: { pricePerUnit: 92.00, currency: 'USD', unitLabel: 'Roll' },
    exampleImageUrl: 'https://images.unsplash.com/photo-1600210492493-0946911123ea?auto=format&fit=crop&w=800&q=80',
    specs: { installationType: 'ROLL', patternRepeat: 60, recommendedWaste: 0.10 }
  },
  {
    id: 'roll-marmol-t9',
    refCode: '14121303',
    name: 'Pared Mármol T9',
    description: 'Exquisite Onyx-style marble with translucent white base and gold/amber veining (T9 style).',
    promptModifier: 'install white onyx marble wall covering, gold and amber veining, translucent stone effect, opulent wall finish',
    thumbnailUrl: 'https://images.unsplash.com/photo-1572450516629-1667be569947?auto=format&fit=crop&w=600&q=80',
    category: 'Rollos Adhesivos',
    usage: 'Interior',
    dimensions: { width: 120, length: 300, thickness: 2 }, // 120cm x 3m
    pricing: { pricePerUnit: 95.00, currency: 'USD', unitLabel: 'Roll' },
    exampleImageUrl: 'https://images.unsplash.com/photo-1574926955745-782b1348007a?auto=format&fit=crop&w=800&q=80',
    specs: { installationType: 'ROLL', patternRepeat: 60, recommendedWaste: 0.10 }
  },
  {
    id: 'roll-marmol-blanco',
    refCode: '14121304',
    name: 'Pared Mármol Blanco',
    description: 'Timeless white Carrara marble style with soft grey veining. Brightens any space.',
    promptModifier: 'install white carrara marble wall covering, soft grey veins, clean white stone texture, bright modern wall',
    thumbnailUrl: 'https://images.unsplash.com/photo-1595113316349-9fa4eb24f884?auto=format&fit=crop&w=600&q=80',
    category: 'Rollos Adhesivos',
    usage: 'Interior',
    dimensions: { width: 120, length: 300, thickness: 2 }, // 120cm x 3m
    pricing: { pricePerUnit: 85.00, currency: 'USD', unitLabel: 'Roll' },
    exampleImageUrl: 'https://images.unsplash.com/photo-1588854337236-688c016308d6?auto=format&fit=crop&w=800&q=80',
    specs: { installationType: 'ROLL', patternRepeat: 60, recommendedWaste: 0.10 }
  },

  // --- ZOCALOS (BASEBOARDS) ---
  {
    id: 'zocalo-roble-claro',
    refCode: '14112410',
    name: 'Roble Claro IXPE S010',
    description: 'Light Oak baseboard molding with vertical grain. Natural bleached wood finish for a clean modern look.',
    promptModifier: 'install vertical grain light oak wood baseboard molding, bleached oak texture, clean carpentry finish',
    thumbnailUrl: 'https://images.unsplash.com/photo-1589578228447-e1a4e481c6c8?auto=format&fit=crop&w=600&q=80', // Updated to Vertical Light Oak
    category: 'Zocalos',
    usage: 'Interior',
    dimensions: { width: 240, length: 6, thickness: 1.3 }, 
    pricing: { pricePerUnit: 25.00, currency: 'USD', unitLabel: 'Piece' },
    exampleImageUrl: 'https://images.unsplash.com/photo-1589578228447-e1a4e481c6c8?auto=format&fit=crop&w=800&q=80',
    specs: { installationType: 'LINEAR', recommendedWaste: 0.10 }
  },
  {
    id: 'zocalo-gris-cenizo',
    refCode: '14112411',
    name: 'Gris Cenizo IXPE S011',
    description: 'Ash Grey baseboard molding. Modern grey wood texture perfectly matches cool toned floors.',
    promptModifier: 'install ash grey wood baseboard molding, modern grey interior trim',
    thumbnailUrl: 'https://images.unsplash.com/photo-1541447270888-83e8494f9c06?auto=format&fit=crop&w=600&q=80', 
    category: 'Zocalos',
    usage: 'Interior',
    dimensions: { width: 240, length: 6, thickness: 1.3 },
    pricing: { pricePerUnit: 25.00, currency: 'USD', unitLabel: 'Piece' },
    exampleImageUrl: 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=800&q=80',
    specs: { installationType: 'LINEAR', recommendedWaste: 0.10 }
  },
  {
    id: 'zocalo-madera-teka',
    refCode: '14112412',
    name: 'Madera Teka IXPE S012',
    description: 'Teak Wood baseboard molding. Rich, warm brown tones for a classic look.',
    promptModifier: 'install teak wood baseboard molding, warm brown wooden trim at floor',
    thumbnailUrl: 'https://images.unsplash.com/photo-1610214352166-51f930198f15?auto=format&fit=crop&w=600&q=80',
    category: 'Zocalos',
    usage: 'Interior',
    dimensions: { width: 240, length: 6, thickness: 1.3 },
    pricing: { pricePerUnit: 28.00, currency: 'USD', unitLabel: 'Piece' },
    exampleImageUrl: 'https://images.unsplash.com/photo-1516455590571-18256e5bb9ff?auto=format&fit=crop&w=800&q=80',
    specs: { installationType: 'LINEAR', recommendedWaste: 0.10 }
  },
  {
    id: 'zocalo-avellana',
    refCode: '14112413',
    name: 'Avellana IXPE S013',
    description: 'Hazelnut Wood baseboard molding. Natural medium-tone beige wood finish.',
    promptModifier: 'install hazelnut oak baseboard molding, natural wood trim',
    thumbnailUrl: 'https://images.unsplash.com/photo-1595846519845-68e298c2edd8?auto=format&fit=crop&w=600&q=80',
    category: 'Zocalos',
    usage: 'Interior',
    dimensions: { width: 240, length: 6, thickness: 1.3 },
    pricing: { pricePerUnit: 28.00, currency: 'USD', unitLabel: 'Piece' },
    exampleImageUrl: 'https://images.unsplash.com/photo-1594235048286-988975a59371?auto=format&fit=crop&w=800&q=80',
    specs: { installationType: 'LINEAR', recommendedWaste: 0.10 }
  },

  // --- LAMINAS SINTETICAS (COUNTERS) ---
  {
    id: 'lamina-piedra-sol',
    refCode: '14121501',
    name: 'Piedra del Sol',
    description: 'Synthetic yellow onyx sheet. Translucent material ideal for backlit counters and reception areas.',
    promptModifier: 'install yellow onyx backlit counter surface, glowing translucent gold stone texture, luxury reception desk',
    thumbnailUrl: 'https://images.unsplash.com/photo-1617139162982-b7557d174692?auto=format&fit=crop&w=600&q=80',
    category: 'Láminas Sintéticas',
    usage: 'Interior',
    dimensions: { width: 122, length: 244, thickness: 0.5 },
    pricing: { pricePerUnit: 120.00, currency: 'USD', unitLabel: 'Sheet' },
    exampleImageUrl: 'https://images.unsplash.com/photo-1584621645335-5e652a4a2b37?auto=format&fit=crop&w=800&q=80',
    specs: { installationType: 'TILE', recommendedWaste: 0.05 }
  },
  {
    id: 'lamina-crema-selecta',
    refCode: '14121502',
    name: 'Crema Selecta',
    description: 'Synthetic cream onyx sheet. Elegant translucent white/beige texture for sophisticated interiors.',
    promptModifier: 'install cream onyx backlit counter surface, soft glowing white stone texture, elegant bathroom vanity',
    thumbnailUrl: 'https://images.unsplash.com/photo-1617094033282-553b6a9a0833?auto=format&fit=crop&w=600&q=80',
    category: 'Láminas Sintéticas',
    usage: 'Interior',
    dimensions: { width: 122, length: 244, thickness: 0.5 },
    pricing: { pricePerUnit: 120.00, currency: 'USD', unitLabel: 'Sheet' },
    exampleImageUrl: 'https://images.unsplash.com/photo-1620626012053-1541e455023c?auto=format&fit=crop&w=800&q=80',
    specs: { installationType: 'TILE', recommendedWaste: 0.05 }
  },

  // --- PISOS SPC (FLOORS) ---
  {
    id: 'spc-roble-claro',
    refCode: '14112010',
    name: 'Roble Claro SPC',
    description: 'Light Oak SPC Flooring (Rigid Core). Water resistant and durable wood-look planks.',
    promptModifier: 'install light oak spc flooring planks, clean modern wood floor',
    thumbnailUrl: 'https://images.unsplash.com/photo-1589578228447-e1a4e481c6c8?auto=format&fit=crop&w=600&q=80', // Match Roble Claro Zocalo
    category: 'Pisos SPC',
    usage: 'Interior',
    dimensions: { width: 18.3, length: 122, thickness: 0.4 },
    pricing: { pricePerUnit: 35.00, currency: 'USD', unitLabel: 'Box' },
    exampleImageUrl: 'https://images.unsplash.com/photo-1581858726768-75e04e56750b?auto=format&fit=crop&w=800&q=80',
    specs: { installationType: 'TILE', recommendedWaste: 0.05 }
  },
  {
    id: 'spc-gris-cenizo',
    refCode: '14112011',
    name: 'Gris Cenizo SPC',
    description: 'Ash Grey SPC Flooring. Contemporary grey tone perfect for modern interiors.',
    promptModifier: 'install ash grey spc flooring planks, modern grey wood floor',
    thumbnailUrl: 'https://images.unsplash.com/photo-1541447270888-83e8494f9c06?auto=format&fit=crop&w=600&q=80', // Match Gris Cenizo Zocalo
    category: 'Pisos SPC',
    usage: 'Interior',
    dimensions: { width: 18.3, length: 122, thickness: 0.4 },
    pricing: { pricePerUnit: 35.00, currency: 'USD', unitLabel: 'Box' },
    exampleImageUrl: 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=800&q=80',
    specs: { installationType: 'TILE', recommendedWaste: 0.05 }
  },
  {
    id: 'spc-avellana',
    refCode: '14112013',
    name: 'Avellana SPC',
    description: 'Hazelnut SPC Flooring. Warm and inviting medium wood tone.',
    promptModifier: 'install hazelnut oak spc flooring planks, warm natural wood floor',
    thumbnailUrl: 'https://images.unsplash.com/photo-1595846519845-68e298c2edd8?auto=format&fit=crop&w=600&q=80', // Match Avellana Zocalo
    category: 'Pisos SPC',
    usage: 'Interior',
    dimensions: { width: 18.3, length: 122, thickness: 0.4 },
    pricing: { pricePerUnit: 35.00, currency: 'USD', unitLabel: 'Box' },
    exampleImageUrl: 'https://images.unsplash.com/photo-1594235048286-988975a59371?auto=format&fit=crop&w=800&q=80',
    specs: { installationType: 'TILE', recommendedWaste: 0.05 }
  },
  {
    id: 'spc-teka',
    refCode: '14112012',
    name: 'Madera Teka SPC',
    description: 'Teak Wood SPC Flooring. Classic rich brown wood finish.',
    promptModifier: 'install teak wood spc flooring planks, classic brown wood floor',
    thumbnailUrl: 'https://images.unsplash.com/photo-1610214352166-51f930198f15?auto=format&fit=crop&w=600&q=80', // Match Teka Zocalo
    category: 'Pisos SPC',
    usage: 'Interior',
    dimensions: { width: 18.3, length: 122, thickness: 0.4 },
    pricing: { pricePerUnit: 38.00, currency: 'USD', unitLabel: 'Box' },
    exampleImageUrl: 'https://images.unsplash.com/photo-1516455590571-18256e5bb9ff?auto=format&fit=crop&w=800&q=80',
    specs: { installationType: 'TILE', recommendedWaste: 0.05 }
  },

  // --- EXTERIOR (DECK) ---
  {
    id: 'deck-cedro',
    refCode: '14113001',
    name: 'Deck Cedro',
    description: 'WPC Decking in Cedar tone. Durable exterior flooring for terraces and pools.',
    promptModifier: 'install cedar wood decking planks, outdoor terrace floor',
    thumbnailUrl: 'https://images.unsplash.com/photo-1601057406734-6c39a3f29053?auto=format&fit=crop&w=600&q=80',
    category: 'Pisos Deck',
    usage: 'Exterior',
    dimensions: { width: 14.8, length: 290, thickness: 2.3 },
    pricing: { pricePerUnit: 45.00, currency: 'USD', unitLabel: 'Piece' },
    exampleImageUrl: 'https://images.unsplash.com/photo-1628744448840-55bdb2497bd4?auto=format&fit=crop&w=800&q=80',
    specs: { installationType: 'TILE', recommendedWaste: 0.10 }
  },
  {
    id: 'deck-grafito',
    refCode: '14113002',
    name: 'Deck Grafito',
    description: 'WPC Decking in Graphite Grey. Modern dark finish for contemporary exteriors.',
    promptModifier: 'install dark graphite grey decking planks, modern outdoor floor',
    thumbnailUrl: 'https://images.unsplash.com/photo-1621256333333-d861d80c0551?auto=format&fit=crop&w=600&q=80',
    category: 'Pisos Deck',
    usage: 'Exterior',
    dimensions: { width: 14.8, length: 290, thickness: 2.3 },
    pricing: { pricePerUnit: 48.00, currency: 'USD', unitLabel: 'Piece' },
    exampleImageUrl: 'https://images.unsplash.com/photo-1631541908759-b141d8d32788?auto=format&fit=crop&w=800&q=80',
    specs: { installationType: 'TILE', recommendedWaste: 0.10 }
  },
  {
    id: 'deck-nogal',
    refCode: '14113003',
    name: 'Deck Nogal',
    description: 'WPC Decking in Walnut tone. Deep, rich wood look.',
    promptModifier: 'install walnut wood decking planks, dark rich brown outdoor floor',
    thumbnailUrl: 'https://images.unsplash.com/photo-1610214352166-51f930198f15?auto=format&fit=crop&w=600&q=80',
    category: 'Pisos Deck',
    usage: 'Exterior',
    dimensions: { width: 14.8, length: 290, thickness: 2.3 },
    pricing: { pricePerUnit: 45.00, currency: 'USD', unitLabel: 'Piece' },
    exampleImageUrl: 'https://images.unsplash.com/photo-1628744448840-55bdb2497bd4?auto=format&fit=crop&w=800&q=80',
    specs: { installationType: 'TILE', recommendedWaste: 0.10 }
  },
  {
    id: 'deck-marron',
    refCode: '14113004',
    name: 'Deck Marrón',
    description: 'WPC Decking in classic Brown.',
    promptModifier: 'install brown wood decking planks, outdoor floor',
    thumbnailUrl: 'https://images.unsplash.com/photo-1589133464332-613d94158656?auto=format&fit=crop&w=600&q=80',
    category: 'Pisos Deck',
    usage: 'Exterior',
    dimensions: { width: 14.8, length: 290, thickness: 2.3 },
    pricing: { pricePerUnit: 45.00, currency: 'USD', unitLabel: 'Piece' },
    exampleImageUrl: 'https://images.unsplash.com/photo-1628744448840-55bdb2497bd4?auto=format&fit=crop&w=800&q=80',
    specs: { installationType: 'TILE', recommendedWaste: 0.10 }
  },
  {
    id: 'deck-teka',
    refCode: '14113005',
    name: 'Deck Teka',
    description: 'WPC Decking in Teak tone.',
    promptModifier: 'install teak wood decking planks, outdoor floor',
    thumbnailUrl: 'https://images.unsplash.com/photo-1610214352166-51f930198f15?auto=format&fit=crop&w=600&q=80',
    category: 'Pisos Deck',
    usage: 'Exterior',
    dimensions: { width: 14.8, length: 290, thickness: 2.3 },
    pricing: { pricePerUnit: 45.00, currency: 'USD', unitLabel: 'Piece' },
    exampleImageUrl: 'https://images.unsplash.com/photo-1628744448840-55bdb2497bd4?auto=format&fit=crop&w=800&q=80',
    specs: { installationType: 'TILE', recommendedWaste: 0.10 }
  },
  // --- EXTERIOR (GARDENS) ---
  {
    id: 'jardin-pradera',
    refCode: '14124201',
    name: 'Jardín Artificial Pradera',
    description: 'Artificial vertical garden panel (Pradera). Lush green foliage for walls.',
    promptModifier: 'install artificial vertical garden wall with mixed green foliage, lush plant wall',
    thumbnailUrl: 'https://images.unsplash.com/photo-1545638515-385038c1a679?auto=format&fit=crop&w=600&q=80',
    category: 'Jardines Artificiales',
    usage: 'Exterior',
    dimensions: { width: 50, length: 50, thickness: 5 },
    pricing: { pricePerUnit: 18.00, currency: 'USD', unitLabel: 'Tile' },
    exampleImageUrl: 'https://images.unsplash.com/photo-1534710961216-75c88202f43e?auto=format&fit=crop&w=800&q=80',
    specs: { installationType: 'TILE', recommendedWaste: 0.05 }
  },
  {
    id: 'jardin-eden',
    refCode: '14124202',
    name: 'Jardín Artificial Eden',
    description: 'Artificial vertical garden panel (Eden). Vibrant light green leaves.',
    promptModifier: 'install artificial vertical garden wall with light green leaves, vibrant plant wall',
    thumbnailUrl: 'https://images.unsplash.com/photo-1557973796-03c72633003b?auto=format&fit=crop&w=600&q=80',
    category: 'Jardines Artificiales',
    usage: 'Exterior',
    dimensions: { width: 50, length: 50, thickness: 5 },
    pricing: { pricePerUnit: 18.00, currency: 'USD', unitLabel: 'Tile' },
    exampleImageUrl: 'https://images.unsplash.com/photo-1534710961216-75c88202f43e?auto=format&fit=crop&w=800&q=80',
    specs: { installationType: 'TILE', recommendedWaste: 0.05 }
  },
];

export const CONTRACTORS: Contractor[] = [
    { id: 'c1', name: 'Elite Installers Inc.', phone: '(555) 123-4567', email: 'contact@eliteinstallers.com', region: 'North' },
    { id: 'c2', name: 'Modern Spaces LLC', phone: '(555) 987-6543', email: 'info@modernspaces.com', region: 'South' },
    { id: 'c3', name: 'Precision Floors & Walls', phone: '(555) 555-5555', email: 'quotes@precisionfw.com', region: 'East' }
];

export const TRANSLATIONS: Record<Language, any> = {
    en: {
        login: {
            email: "Email Address",
            password: "Password",
            signIn: "Sign In",
            skip: "Skip for now (Demo)"
        },
        landing: {
            title: "Visualize.",
            materials: "Quote.",
            subtitle: "Select your project type to browse our exclusive catalog of architectural materials.",
            interiors: "Interiors",
            interiorsDesc: "Floors, Walls & Baseboards",
            exterior: "Exterior",
            exteriorDesc: "Decking & Gardens",
            furniture: "Furniture",
            furnitureDesc: "Sofas & Tables"
        },
        steps: {
            select: "Select",
            capture: "Capture",
            visualize: "Visualize",
            quote: "Quote"
        },
        gallery: {
            back: "Back",
            collection: "Collection",
            dimensions: "Dimensions",
            noMaterials: "No materials found in this category."
        },
        modal: {
            price: "Price",
            dimensions: "Dimensions",
            visualize: "Visualize in My Space",
            quote: "Calculate Quote"
        },
        editor: {
            back: "Back to Camera",
            errorTitle: "Generation Error",
            processing: "Processing...",
            configuration: "Configuration",
            material: "Selected Material",
            instructions: "Custom Instructions",
            templates: "Quick Templates",
            generate: "Generate View",
            regenerate: "Regenerate",
            createQuote: "Create Quote"
        },
        quote: {
            area: "Surface Area",
            linear: "Linear Length",
            width: "Width",
            perimeter: "Perimeter",
            height: "Height",
            pattern: "Installation Pattern",
            waste: "Waste Factor",
            breakdown: "Calculation Logic",
            summary: "Quote Summary",
            dimensions: "Input Dimensions",
            quantity: "Required Quantity",
            cost: "Estimated Cost",
            assignContractor: "Assign Contractor",
            selectContractor: "Select a contractor...",
            addToCart: "Add to Cart",
            emailSubject: "Quote Request for",
            emailBody: "I would like to request a formal quote for the following material",
            material: "Material",
            units: "Units Required"
        },
        cart: {
            title: "Shopping Cart",
            empty: "Your cart is empty.",
            browse: "Browse Materials",
            remove: "Remove",
            total: "Grand Total",
            continue: "Continue Shopping",
            checkout: "Checkout via Email",
            confirmOrder: "Confirm Order Details",
            openGmail: "Open in Gmail"
        },
        common: {
            back: "Back",
            cancel: "Cancel",
            email: "Email",
            optional: "Optional"
        }
    },
    es: {
        login: {
            email: "Correo Electrónico",
            password: "Contraseña",
            signIn: "Iniciar Sesión",
            skip: "Omitir por ahora (Demo)"
        },
        landing: {
            title: "Visualiza.",
            materials: "Cotiza.",
            subtitle: "Selecciona tu tipo de proyecto para ver nuestro catálogo exclusivo.",
            interiors: "Interiores",
            interiorsDesc: "Pisos, Paredes y Zócalos",
            exterior: "Exteriores",
            exteriorDesc: "Decks y Jardines",
            furniture: "Mobiliario",
            furnitureDesc: "Sofás y Mesas"
        },
        steps: {
            select: "Seleccionar",
            capture: "Capturar",
            visualize: "Visualizar",
            quote: "Cotizar"
        },
        gallery: {
            back: "Volver",
            collection: "Colección",
            dimensions: "Dimensiones",
            noMaterials: "No hay materiales en esta categoría."
        },
        modal: {
            price: "Precio",
            dimensions: "Dimensiones",
            visualize: "Visualizar en mi Espacio",
            quote: "Calcular Cotización"
        },
        editor: {
            back: "Volver a Cámara",
            errorTitle: "Error de Generación",
            processing: "Procesando...",
            configuration: "Configuración",
            material: "Material Seleccionado",
            instructions: "Instrucciones Personalizadas",
            templates: "Plantillas Rápidas",
            generate: "Generar Vista",
            regenerate: "Regenerar",
            createQuote: "Crear Cotización"
        },
        quote: {
            area: "Área de Superficie",
            linear: "Longitud Lineal",
            width: "Ancho",
            perimeter: "Perímetro",
            height: "Altura",
            pattern: "Patrón de Instalación",
            waste: "Factor de Desperdicio",
            breakdown: "Lógica de Cálculo",
            summary: "Resumen de Cotización",
            dimensions: "Dimensiones Ingresadas",
            quantity: "Cantidad Requerida",
            cost: "Costo Estimado",
            assignContractor: "Asignar Contratista",
            selectContractor: "Seleccionar contratista...",
            addToCart: "Añadir al Carrito",
            emailSubject: "Solicitud de Cotización para",
            emailBody: "Me gustaría solicitar una cotización formal para el siguiente material",
            material: "Material",
            units: "Unidades Requeridas"
        },
        cart: {
            title: "Carrito de Compras",
            empty: "Tu carrito está vacío.",
            browse: "Ver Materiales",
            remove: "Eliminar",
            total: "Gran Total",
            continue: "Seguir Comprando",
            checkout: "Finalizar por Email",
            confirmOrder: "Confirmar Detalles",
            openGmail: "Abrir en Gmail"
        },
        common: {
            back: "Volver",
            cancel: "Cancelar",
            email: "Enviar Email",
            optional: "Opcional"
        }
    }
};
