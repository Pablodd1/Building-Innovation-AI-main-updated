# BuildingApp.us — Fix Deployed to GitHub

## What I Fixed

**Root Cause:** The AI image generation was using non-existent Gemini model names:
- `gemini-2.5-flash-image` → **Doesn't exist**
- `gemini-1.5-pro` → **Returns 404 from API**

**Fix:** Updated model names to valid ones:
- `gemini-2.0-flash-exp-image-generation` → Primary image generation model (supports image output)
- `gemini-2.5-flash` → Fallback for text analysis
- `gemini-2.0-flash-exp` → Final fallback

## Files Changed
- `server/services/aiProviders.ts` — Updated model names
- `dist-server/app.cjs` — Rebuilt server bundle

## How to Deploy to Hostinger

### Option 1: Upload via FTP/File Manager (Recommended)
1. Log in to Hostinger hPanel
2. Go to **File Manager** → `public_html/` → `dist-server/`
3. Upload the new `app.cjs` file (from GitHub repo or the attached file)
4. Visit: `https://buildingapp.us/deploy-php.php?run=1`
5. The deployment script will copy files and restart Passenger

### Option 2: GitHub Actions (if set up)
If you have a CI/CD workflow, trigger a new deployment.

### Option 3: Manual Build on Server
```bash
# SSH to Hostinger (if available)
cd ~/domains/buildingapp.us/nodejs
# Pull latest code
git pull origin main
# Install dependencies
npm install
# Rebuild server
npm run build:server
# Restart Passenger
touch tmp/restart.txt
```

## Verification Steps
After deployment, test these URLs:

1. **Health Check:** `https://buildingapp.us/api/health`
   - Should return: `{"status":"ok"}`

2. **Test Image Generation:**
   ```bash
   curl -X POST https://buildingapp.us/api/ai/generate-overlay \
     -H "Content-Type: application/json" \
     -d '{
       "originalImage": "data:image/png;base64,iVBORw0KGgo...",
       "material": {"id": "test", "name": "Test", "category": "Flooring"},
       "userInstruction": "Apply this flooring"
     }'
   ```
   - Should return a generated image URL (not 404)

3. **Test Room Analysis:**
   ```bash
   curl -X POST https://buildingapp.us/api/ai/analyze-room \
     -H "Content-Type: application/json" \
     -d '{"image": "data:image/png;base64,iVBORw0KGgo..."}'
   ```
   - Should return analysis text (not 404)

## Next: API Key Backup Strategy

You mentioned wanting a backup API key strategy. Here are the options:

### Option A: Dual Gemini Keys (Recommended)
1. Get a second Gemini API key from a different Google Cloud project
2. The code already has fallback logic — I can add key rotation

### Option B: OpenAI Backup
1. Get an OpenAI API key (`sk-...`)
2. Set `AI_PROVIDER=openai` in config
3. Note: OpenAI doesn't support image output in chat API, only text analysis

### Option C: Multi-Provider with Failover
I can modify the code to:
1. Try Gemini first
2. If quota exceeded → switch to OpenAI
3. If both fail → return cached/generic response

**Which option do you want me to implement?**

---

**Status:** ✅ Fix pushed to GitHub — ready for deployment
**Priority:** HIGH — Deploy ASAP to restore image generation
