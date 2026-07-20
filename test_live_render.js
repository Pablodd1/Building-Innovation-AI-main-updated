import fs from 'fs';
import { Buffer } from 'buffer';
import sharp from 'sharp';

const BASE_URL = 'https://buildingapp.us';
const IMAGE_PATH = 'C:\\Users\\jasme\\Downloads\\sample_room.jpg';
async function runTest() {
    console.log("1. Reading and re-encoding local sample room image with sharp...");
    const fileData = fs.readFileSync(IMAGE_PATH);
    const reEncodedBuffer = await sharp(fileData).jpeg({ quality: 80 }).toBuffer();
    const base64Image = reEncodedBuffer.toString('base64');
    const imagePayload = `data:image/jpeg;base64,${base64Image}`;

    console.log("2. Sending to /api/ai/analyze-room...");
    const analyzeRes = await fetch(`${BASE_URL}/api/ai/analyze-room`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imagePayload })
    });
    
    if (!analyzeRes.ok) {
        console.error("Analyze failed:", await analyzeRes.text());
        return;
    }
    const analysis = await analyzeRes.json();
    console.log("Analysis Result Surfaces:", analysis.surfaces);

    console.log("3. Sending to /api/ai/generate-overlay...");
    const material = {
        name: "FOAM BOARD BURDEO - LINEA ZEN",
        category: "LAMINAS",
        imageUrl: "https://buildingapp.us/product-webp/14181104.webp",
        refCode: "14181104"
    };
    
    const generateRes = await fetch(`${BASE_URL}/api/ai/generate-overlay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            originalImage: imagePayload,
            material: material,
            userInstruction: "Apply this hardwood flooring to the floor",
            analysis: analysis
        })
    });
    
    if (!generateRes.ok) {
        console.error("Generate failed:", await generateRes.text());
        return;
    }
    const generateData = await generateRes.json();
    
    console.log("4. Saving generated image...");
    const base64Data = generateData.image.replace(/^data:image\/\w+;base64,/, "");
    const outputBuffer = Buffer.from(base64Data, 'base64');
    
    // Save to the artifacts folder
    const outputPath = 'C:\\Users\\jasme\\.gemini\\antigravity\\brain\\4844b23b-e0d6-407a-94fd-af0f60a0c0c8\\live_render_result.png';
    fs.writeFileSync(outputPath, outputBuffer);
    console.log(`✅ Saved successfully to ${outputPath}`);
}

runTest().catch(console.error);
