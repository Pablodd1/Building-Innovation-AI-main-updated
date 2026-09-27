import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const srcIcon = path.resolve('public', 'icon-512.png');

if (!fs.existsSync(srcIcon)) {
    console.error(`Source icon not found at ${srcIcon}`);
    process.exit(1);
}

const androidResDir = path.resolve('android', 'app', 'src', 'main', 'res');

const androidSizes = [
    { dir: 'mipmap-mdpi', iconSize: 48, fgSize: 108 },
    { dir: 'mipmap-hdpi', iconSize: 72, fgSize: 162 },
    { dir: 'mipmap-xhdpi', iconSize: 96, fgSize: 216 },
    { dir: 'mipmap-xxhdpi', iconSize: 144, fgSize: 324 },
    { dir: 'mipmap-xxxhdpi', iconSize: 192, fgSize: 432 }
];

async function generateIcons() {
    console.log(`Generating Android launcher icons from ${srcIcon}...`);

    for (const item of androidSizes) {
        const targetDir = path.join(androidResDir, item.dir);
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        // 1. Standard launcher icon
        const launcherPath = path.join(targetDir, 'ic_launcher.png');
        await sharp(srcIcon)
            .resize(item.iconSize, item.iconSize)
            .toFile(launcherPath);
        console.log(`✓ Generated ${launcherPath} (${item.iconSize}x${item.iconSize})`);

        // 2. Round launcher icon
        const roundPath = path.join(targetDir, 'ic_launcher_round.png');
        // Create circular mask
        const circleSvg = Buffer.from(
            `<svg><circle cx="${item.iconSize / 2}" cy="${item.iconSize / 2}" r="${item.iconSize / 2}" fill="#fff"/></svg>`
        );
        await sharp(srcIcon)
            .resize(item.iconSize, item.iconSize)
            .composite([{ input: circleSvg, blend: 'dest-in' }])
            .toFile(roundPath);
        console.log(`✓ Generated ${roundPath} (${item.iconSize}x${item.iconSize})`);

        // 3. Foreground icon (with padding for adaptive icon)
        const fgPath = path.join(targetDir, 'ic_launcher_foreground.png');
        const innerSize = Math.round(item.fgSize * 0.72);
        const padding = Math.round((item.fgSize - innerSize) / 2);

        const resizedInner = await sharp(srcIcon)
            .resize(innerSize, innerSize)
            .toBuffer();

        await sharp({
            create: {
                width: item.fgSize,
                height: item.fgSize,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            }
        })
        .composite([{ input: resizedInner, top: padding, left: padding }])
        .png()
        .toFile(fgPath);
        console.log(`✓ Generated ${fgPath} (${item.fgSize}x${item.fgSize})`);
    }

    // iOS AppIcon
    const iosIconDir = path.resolve('ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset');
    if (fs.existsSync(iosIconDir)) {
        const iosPath = path.join(iosIconDir, 'AppIcon-512@2x.png');
        await sharp(srcIcon)
            .resize(1024, 1024)
            .toFile(iosPath);
        console.log(`✓ Generated iOS AppIcon at ${iosPath} (1024x1024)`);
    }

    // Also copy 512x512 icon to google-play-listing directory
    const playIconDir = path.resolve('google-play-listing', 'graphics');
    if (!fs.existsSync(playIconDir)) fs.mkdirSync(playIconDir, { recursive: true });
    const playIconPath = path.join(playIconDir, 'icon-512x512.png');
    await sharp(srcIcon).resize(512, 512).toFile(playIconPath);
    console.log(`✓ Saved 512x512 icon for Google Play Console to ${playIconPath}`);

    console.log('All icons generated successfully!');
}

generateIcons().catch(err => {
    console.error('Error generating icons:', err);
    process.exit(1);
});
