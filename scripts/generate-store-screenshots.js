import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const outDir = path.resolve('google-play-listing', 'screenshots');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const desktopDir = path.resolve('C:\\Users\\jasme\\Desktop\\screenshots_playstore');
if (!fs.existsSync(desktopDir)) fs.mkdirSync(desktopDir, { recursive: true });

const brainDir = 'C:\\Users\\jasme\\.gemini\\antigravity\\brain\\4844b23b-e0d6-407a-94fd-af0f60a0c0c8';

async function createScreen({ title, subtitle, appImageSrc, outputPath }) {
    const width = 1080;
    const height = 1920;

    // Load and resize the app screenshot to fit inside the frame
    let appBuffer;
    if (fs.existsSync(appImageSrc)) {
        appBuffer = await sharp(appImageSrc)
            .resize(960, 1340, { fit: 'contain', background: { r: 15, g: 23, b: 42, alpha: 1 } })
            .png()
            .toBuffer();
    } else {
        appBuffer = await sharp({
            create: { width: 960, height: 1340, channels: 4, background: { r: 30, g: 41, b: 59, alpha: 1 } }
        }).png().toBuffer();
    }

    // Create SVG overlay for title and phone frame
    const svgHeader = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="bg" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="#0f172a" />
                <stop offset="50%" stop-color="#1e293b" />
                <stop offset="100%" stop-color="#090d16" />
            </linearGradient>
            <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#3b82f6" />
                <stop offset="100%" stop-color="#8b5cf6" />
            </linearGradient>
            <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
                <feDropShadow dx="0" dy="16" stdDeviation="24" flood-color="#000" flood-opacity="0.6"/>
            </filter>
        </defs>

        <!-- Background -->
        <rect width="${width}" height="${height}" fill="url(#bg)" />

        <!-- Accent Top Pill -->
        <rect x="390" y="70" width="300" height="36" rx="18" fill="url(#accent)" opacity="0.9" />
        <text x="540" y="94" font-family="-apple-system, Roboto, sans-serif" font-size="18" font-weight="bold" fill="#ffffff" text-anchor="middle" letter-spacing="1">BUILDING INNOVATION AI</text>

        <!-- Main Title -->
        <text x="540" y="190" font-family="-apple-system, Roboto, sans-serif" font-size="52" font-weight="900" fill="#ffffff" text-anchor="middle">${title}</text>

        <!-- Subtitle -->
        <text x="540" y="250" font-family="-apple-system, Roboto, sans-serif" font-size="30" font-weight="500" fill="#94a3b8" text-anchor="middle">${subtitle}</text>

        <!-- Phone Frame Border -->
        <rect x="52" y="312" width="976" height="1556" rx="44" fill="#0f172a" stroke="#334155" stroke-width="8" filter="url(#shadow)"/>
        <!-- Phone Camera Notch / Dynamic Island -->
        <rect x="440" y="328" width="200" height="28" rx="14" fill="#020617" />
    </svg>
    `;

    const baseBg = await sharp(Buffer.from(svgHeader)).png().toBuffer();

    await sharp(baseBg)
        .composite([
            { input: appBuffer, top: 380, left: 60 }
        ])
        .png({ quality: 100 })
        .toFile(outputPath);

    console.log(`✓ Created screenshot: ${outputPath}`);
}

async function createFeatureGraphic(outputPath) {
    const width = 1024;
    const height = 500;

    const iconPath = path.resolve('public', 'icon-512.png');
    let iconBuffer = null;
    if (fs.existsSync(iconPath)) {
        iconBuffer = await sharp(iconPath).resize(160, 160).png().toBuffer();
    }

    const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="fgbg" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#0b132b" />
                <stop offset="50%" stop-color="#1c2541" />
                <stop offset="100%" stop-color="#3a506b" />
            </linearGradient>
            <linearGradient id="textGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#60a5fa" />
                <stop offset="100%" stop-color="#a78bfa" />
            </linearGradient>
        </defs>
        <rect width="${width}" height="${height}" fill="url(#fgbg)" />
        <circle cx="850" cy="250" r="180" fill="#3b82f6" opacity="0.1" />
        <circle cx="150" cy="350" r="120" fill="#8b5cf6" opacity="0.1" />

        <text x="512" y="270" font-family="-apple-system, Roboto, sans-serif" font-size="44" font-weight="900" fill="#ffffff" text-anchor="middle" letter-spacing="1">Building Innovation AI</text>
        <text x="512" y="325" font-family="-apple-system, Roboto, sans-serif" font-size="24" font-weight="500" fill="url(#textGrad)" text-anchor="middle">Visualizador Arquitectónico y Estimador Instantáneo</text>
        <text x="512" y="375" font-family="-apple-system, Roboto, sans-serif" font-size="18" font-weight="400" fill="#94a3b8" text-anchor="middle">Láminas PVC • Pisos SPC • Paneles Acústicos • Mármol</text>
    </svg>
    `;

    const compositeItems = [];
    if (iconBuffer) {
        compositeItems.push({ input: iconBuffer, top: 60, left: 432 });
    }

    await sharp(Buffer.from(svg))
        .composite(compositeItems)
        .png({ quality: 100 })
        .toFile(outputPath);

    console.log(`✓ Created feature graphic: ${outputPath}`);
}

async function run() {
    console.log('Generating Play Store compliant screenshots...');

    const screens = [
        {
            title: 'Visualización con IA en Segundos',
            subtitle: 'Simulación fotorrealista en tus propias paredes',
            appImageSrc: path.join(brainDir, 'final_result_splitscreen.png'),
            file: '1_visualizador_split.png'
        },
        {
            title: 'Análisis de Habitación con IA',
            subtitle: 'Detección automática de paredes y perspectiva',
            appImageSrc: path.join(brainDir, 'room_analysis_completed_and_selected_material.png'),
            file: '2_analisis_ia.png'
        },
        {
            title: 'Catálogo de 300+ Materiales',
            subtitle: 'Láminas PVC, SPC, madera y revestimientos',
            appImageSrc: path.join(brainDir, 'catalog_page.png'),
            file: '3_catalogo_materiales.png'
        },
        {
            title: 'Cotizaciones y Metrajes al Instante',
            subtitle: 'Área calculada y presupuesto de paneles en tiempo real',
            appImageSrc: path.join(brainDir, 'final_result_compositor.png'),
            file: '4_estimador_presupuesto.png'
        }
    ];

    for (const sc of screens) {
        const p1 = path.join(outDir, sc.file);
        const p2 = path.join(desktopDir, sc.file);
        await createScreen({ title: sc.title, subtitle: sc.subtitle, appImageSrc: sc.appImageSrc, outputPath: p1 });
        fs.copyFileSync(p1, p2);
    }

    const fg1 = path.join(path.resolve('google-play-listing', 'graphics'), 'feature-graphic-1024x500.png');
    const fg2 = path.join(desktopDir, 'feature_graphic_1024x500.png');
    await createFeatureGraphic(fg1);
    fs.copyFileSync(fg1, fg2);

    console.log('All screenshots and graphics generated successfully in Desktop/screenshots_playstore!');
}

run().catch(err => {
    console.error('Error generating screenshots:', err);
    process.exit(1);
});
