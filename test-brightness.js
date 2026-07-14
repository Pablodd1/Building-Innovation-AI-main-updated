import sharp from 'sharp';
import fs from 'fs';

async function testBrightness() {
    const PRODUCT_URL = 'https://buildingapp.us/products/14031001.webp';
    const res = await fetch(PRODUCT_URL);
    const productBuffer = Buffer.from(await res.arrayBuffer());

    const { channels } = await sharp(productBuffer).stats();
    const brightness = (channels[0].mean + channels[1].mean + channels[2].mean) / 3;
    console.log("Average Brightness:", brightness);
}

testBrightness().catch(console.error);
