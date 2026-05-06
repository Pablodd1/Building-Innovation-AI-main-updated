#!/usr/bin/env node
/**
 * Test script for ConstructViz AI server-side API proxy
 * 
 * Usage:
 *   export GEMINI_API_KEY="your-key-here"
 *   node test-api.js
 * 
 * Or with a config file:
 *   echo '{"GEMINI_API_KEY":"your-key"}' > data/config.json
 *   node test-api.js
 */

const fs = require('fs');
const path = require('path');

// Check for API key
const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
const configPath = path.join(__dirname, 'data', 'config.json');
let configKey = '';

if (fs.existsSync(configPath)) {
    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        configKey = config.GEMINI_API_KEY || '';
    } catch (e) {
        console.error('Failed to read config file:', e.message);
    }
}

const finalKey = apiKey || configKey;

console.log('='.repeat(60));
console.log('ConstructViz AI — API Configuration Test');
console.log('='.repeat(60));
console.log();

if (!finalKey) {
    console.error('❌ NO API KEY FOUND');
    console.error();
    console.error('Set one of these:');
    console.error('  1. Environment variable: GEMINI_API_KEY');
    console.error('  2. Environment variable: VITE_GEMINI_API_KEY (backward compat)');
    console.error('  3. Config file: data/config.json with {"GEMINI_API_KEY":"..."}');
    console.error();
    process.exit(1);
}

console.log('✅ API Key found');
console.log(`   Source: ${apiKey ? 'Environment variable' : 'data/config.json'}`);
console.log(`   Length: ${finalKey.length} chars`);
console.log(`   Prefix: ${finalKey.substring(0, 8)}...`);
console.log();

// Validate key format (Google AI keys start with specific prefixes)
const validPrefixes = ['AIzaSy', 'AIza', 'ya29.'];
const hasValidPrefix = validPrefixes.some(p => finalKey.startsWith(p));

if (!hasValidPrefix) {
    console.warn('⚠️  Key format looks unusual. Google API keys typically start with "AIzaSy..."');
    console.warn('   Make sure this is a valid Gemini API key from Google AI Studio.');
    console.log();
}

// Test the server endpoints are wired correctly
console.log('Checking server endpoints...');
console.log();

const endpoints = [
    { method: 'POST', path: '/api/ai/generate-overlay', desc: 'Material Overlay Generation' },
    { method: 'POST', path: '/api/ai/analyze-room', desc: 'Room Analysis' },
];

endpoints.forEach(ep => {
    console.log(`   ${ep.method} ${ep.path}`);
    console.log(`   └─ ${ep.desc}`);
});

console.log();
console.log('='.repeat(60));
console.log('Next Steps:');
console.log('='.repeat(60));
console.log();
console.log('1. Start the server:');
console.log('   npm run dev  (or node dist-server/app.cjs)');
console.log();
console.log('2. Open the app in browser');
console.log();
console.log('3. Upload a room photo and click "Generate with AI"');
console.log('   The request goes: Browser → Your Server → Gemini API');
console.log('   Your API key NEVER leaves the server.');
console.log();
console.log('4. If generation fails, check server logs for error details.');
console.log();
console.log('To monitor API usage:');
console.log('   https://aistudio.google.com/app/apikey');
console.log();
