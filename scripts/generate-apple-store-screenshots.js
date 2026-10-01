import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const outDir67 = path.resolve('apple-store-listing', 'screenshots', '6.7_inch');
const outDir65 = path.resolve('apple-store-listing', 'screenshots', '6.5_inch');
const desktopDir = path.resolve('C:\\Users\\jasme\\Desktop\\screenshots_appstore');

if (!fs.existsSync(outDir67)) fs.mkdirSync(outDir67, { recursive: true });
if (!fs.existsSync(outDir65)) fs.mkdirSync(outDir65, { recursive: true });
if (!fs.existsSync(desktopDir)) fs.mkdirSync(desktopDir, { recursive: true });

const brainDir = 'C:\\Users\\jasme\\.gemini\\antigravity\\brain\\4844b23b-e0d6-407a-94fd-af0f60a0c0c8';

async function createIOSScreen({ title, subtitle, appImageSrc, outputPath, width, height }) {
    const scale = width / 1290;
    const phoneWidth = Math.round(1160 * scale);
    const phoneHeight = Math.round(2180 * scale);
    const phoneX = Math.round((width - phoneWidth) / 2);
    const phoneY = Math.round(440 * scale);

    const appInnerWidth = Math.round(1120 * scale);
    const appInnerHeight = Math.round(2040 * scale);
    const appInnerX = Math.round((width - appInnerWidth) / 2);
    const appInnerY = Math.round(520 * scale);

    // Load and resize the app screenshot
    let appBuffer;
    if (fs.existsSync(appImageSrc)) {
        appBuffer = await sharp(appImageSrc)
            .resize(appInnerWidth, appInnerHeight, { fit: 'contain', background: { r: 15, g: 23, b: 42, alpha: 1 } })
            .png()
            .toBuffer();
    } else {
        appBuffer = await sharp({
            create: { width: appInnerWidth, height: appInnerHeight, channels: 4, background: { r: 30, g: 41, b: 59, alpha: 1 } }
        }).png().toBuffer();
    }

    const titleSize = Math.round(58 * scale);
    const subSize = Math.round(34 * scale);
    const badgeSize = Math.round(22 * scale);

    const svgHeader = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="bg" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="#090d16" />
                <stop offset="35%" stop-color="#111827" />
                <stop offset="100%" stop-color="#030712" />
            </linearGradient>
            <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#3b82f6" />
                <stop offset="100%" stop-color="#8b5cf6" />
            </linearGradient>
            <filter id="phoneShadow" x="-10%" y="-10%" width="120%" height="120%">
                <feDropShadow dx="0" dy="25" stdDeviation="35" flood-color="#000000" flood-opacity="0.75"/>
            </filter>
        </defs>

        <!-- Premium Dark Background -->
        <rect width="${width}" height="${height}" fill="url(#bg)" />

        <!-- Accent Top Badge -->
        <rect x="${(width - 380 * scale) / 2}" y="${80 * scale}" width="${380 * scale}" height="${46 * scale}" rx="${23 * scale}" fill="url(#accent)" opacity="0.95" />
        <text x="${width / 2}" y="${110 * scale}" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Display', Roboto, sans-serif" font-size="${badgeSize}" font-weight="700" fill="#ffffff" text-anchor="middle" letter-spacing="1.5">BUILDING INNOVATION AI</text>

        <!-- Main Title -->
        <text x="${width / 2}" y="${220 * scale}" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Display', Roboto, sans-serif" font-size="${titleSize}" font-weight="900" fill="#ffffff" text-anchor="middle">${title}</text>

        <!-- Subtitle -->
        <text x="${width / 2}" y="${290 * scale}" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Text', Roboto, sans-serif" font-size="${subSize}" font-weight="500" fill="#94a3b8" text-anchor="middle">${subtitle}</text>

        <!-- iPhone Bezel / Frame -->
        <rect x="${phoneX}" y="${phoneY}" width="${phoneWidth}" height="${phoneHeight}" rx="${60 * scale}" fill="#0f172a" stroke="#374151" stroke-width="${10 * scale}" filter="url(#phoneShadow)"/>
        
        <!-- iPhone Dynamic Island (iOS specific) -->
        <rect x="${(width - 240 * scale) / 2}" y="${phoneY + 22 * scale}" width="${240 * scale}" height="${40 * scale}" rx="${20 * scale}" fill="#000000" />
    </svg>
    `;

    const baseBg = await sharp(Buffer.from(svgHeader)).png().toBuffer();

    await sharp(baseBg)
        .composite([
            { input: appBuffer, top: appInnerY, left: appInnerX }
        ])
        .png({ quality: 100 })
        .toFile(outputPath);

    console.log(`✓ Created iOS screenshot: ${outputPath} (${width}x${height})`);
}

async function run() {
    console.log('Generating Apple App Store compliant screenshots (6.7" and 6.5")...');

    const screens = [
        {
            title: 'Visualizador con IA',
            subtitle: 'Renderizado fotorrealista en tus muros reales',
            appImageSrc: path.join(brainDir, 'final_result_splitscreen.png'),
            file: '1_visualizador_split.png'
        },
        {
            title: 'Análisis Inteligente',
            subtitle: 'Detección automática de perspectiva y geometría',
            appImageSrc: path.join(brainDir, 'room_analysis_completed_and_selected_material.png'),
            file: '2_analisis_ia.png'
        },
        {
            title: 'Catálogo de Materiales',
            subtitle: 'Más de 320 láminas de PVC, SPC y mármol',
            appImageSrc: path.join(brainDir, 'catalog_page.png'),
            file: '3_catalogo_materiales.png'
        },
        {
            title: 'Estimador de Presupuesto',
            subtitle: 'Cálculo de área ($m^2$), piezas y cotización instantánea',
            appImageSrc: path.join(brainDir, 'final_result_compositor.png'),
            file: '4_estimador_presupuesto.png'
        }
    ];

    for (const sc of screens) {
        // 1. iPhone 6.7" (1290 x 2796)
        const p67 = path.join(outDir67, sc.file);
        const pDesk67 = path.join(desktopDir, `6.7_${sc.file}`);
        await createIOSScreen({ title: sc.title, subtitle: sc.subtitle, appImageSrc: sc.appImageSrc, outputPath: p67, width: 1290, height: 2796 });
        fs.copyFileSync(p67, pDesk67);

        // 2. iPhone 6.5" (1242 x 2688)
        const p65 = path.join(outDir65, sc.file);
        const pDesk65 = path.join(desktopDir, `6.5_${sc.file}`);
        await createIOSScreen({ title: sc.title, subtitle: sc.subtitle, appImageSrc: sc.appImageSrc, outputPath: p65, width: 1242, height: 2688 });
        fs.copyFileSync(p65, pDesk65);
    }

    console.log('All iOS screenshots generated successfully in Desktop/screenshots_appstore and apple-store-listing/screenshots!');
}

run().catch(err => {
    console.error('Error generating iOS screenshots:', err);
    process.exit(1);
});
