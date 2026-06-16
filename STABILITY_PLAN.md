# Building Innovation AI — Stability & Production Plan

## Current Status (Fixed)

| Component | Status | Notes |
|---|---|---|
| Repo | `Pablodd1/Building-Innovation-AI-main-updated` | ✅ Correct |
| Gemini model | `gemini-2.5-flash-image` | ✅ Supports image output |
| Frontend | Vercel (`binnovation-web`) | ✅ Auto-deploys from Git |
| Backend | Hostinger (`buildingapp.us`) | ⚠️ Manual deploy needed |
| API key | In `data/config.json` | ✅ Working |

---

## The Root Problems (Why Things Break)

### 1. **Model Name Changes**
Google frequently renames or deprecates Gemini models. `gemini-2.5-flash` → `gemini-2.5-flash-image` broke image generation.

### 2. **Dual Deployment**
- Frontend on Vercel (auto-deploys)
- Backend on Hostinger (manual deploy)
- They get out of sync

### 3. **No Health Monitoring**
No automated checks if the API is actually working.

### 4. **API Key in JSON File**
`data/config.json` is not in `.gitignore` (was removed). Key can be accidentally committed.

---

## Permanent Solutions

### Solution 1: Use Environment Variables (CRITICAL)

Move the Gemini API key from `data/config.json` to **environment variables**.

**Why:**
- Hostinger and Vercel both support env vars
- Keys never touch GitHub
- Can rotate keys without code changes

**How:**
```bash
# On Hostinger (cPanel → Node.js → Environment Variables)
GEMINI_API_KEY=your-key-here

# On Vercel (Project Settings → Environment Variables)
GEMINI_API_KEY=your-key-here
```

**Code change needed:**
```typescript
// server/services/aiProviders.ts
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || config.GEMINI_API_KEY;
```

---

### Solution 2: Model Fallback Chain

Don't hardcode one model. Try the best one, fall back to others:

```typescript
const IMAGE_MODELS = [
  "gemini-2.5-flash-image",      // Best for images
  "gemini-2.0-flash-exp",         // Experimental fallback
  "gemini-1.5-pro",               // Stable fallback
];

async function generateWithFallback(contents, prompt) {
  for (const model of IMAGE_MODELS) {
    try {
      return await ai.models.generateContent({ 
        model, 
        contents, 
        config: { responseModalities: ["TEXT", "IMAGE"] } 
      });
    } catch (e) {
      if (e.message.includes("not found") || e.message.includes("not supported")) {
        console.warn(`Model ${model} failed, trying next...`);
        continue;
      }
      throw e; // Re-throw if it's not a model issue
    }
  }
  throw new Error("All image models failed");
}
```

---

### Solution 3: Unified Deployment (Recommended)

**Option A: Move everything to Vercel**
- Vercel supports Node.js serverless functions
- One deploy button, frontend + backend together
- No more Hostinger manual deploys

**Option B: Keep Hostinger but add GitHub Actions**
- Auto-deploy to Hostinger on every push
- Use FTP or SSH in GitHub Actions

**Option C: Docker + Single Host**
- One container, one deploy
- Easiest for app stores

---

### Solution 4: Health Check Endpoint

Add a `/api/health` that actually tests the Gemini API:

```typescript
app.get('/api/health', async (req, res) => {
  const checks = {
    server: 'ok',
    database: 'ok',
    gemini: 'unknown',
  };
  
  try {
    // Quick Gemini test (1 token)
    await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
    });
    checks.gemini = 'ok';
  } catch (e) {
    checks.gemini = 'error: ' + e.message;
  }
  
  const allOk = Object.values(checks).every(v => v === 'ok');
  res.status(allOk ? 200 : 503).json({ 
    status: allOk ? 'healthy' : 'degraded', 
    checks 
  });
});
```

---

### Solution 5: Structured Logging

Add proper error tracking so you know when things break:

```typescript
// Instead of console.log
import { createLogger } from './utils/logger';
const logger = createLogger('ai-providers');

logger.info('Generating overlay', { userId, materialId, model });
logger.error('Gemini API failed', { error: e.message, model, status: e.status });
```

---

## Immediate Action Items

| Priority | Task | Owner |
|---|---|---|
| 🔴 **P0** | Move API keys to environment variables | You (Hostinger + Vercel panels) |
| 🔴 **P0** | Deploy fixed `dist-server/app.cjs` to Hostinger | You (FTP/cPanel) |
| 🟡 **P1** | Add model fallback chain | Me (code change) |
| 🟡 **P1** | Add health check that tests Gemini | Me (code change) |
| 🟢 **P2** | Set up GitHub Actions for auto-deploy | Me (config) |
| 🟢 **P2** | Add structured logging | Me (code change) |

---

## For App Store Submission

Apple and Google require:
1. **Privacy policy** — Data handling disclosure
2. **Terms of service** — User agreement
3. **No hardcoded keys** — Use secure storage (Keychain/Keystore)
4. **Offline handling** — Graceful degradation when API is down
5. **Rate limiting** — Don't hammer the API

---

## What I Need From You

1. **Hostinger FTP/cPanel access** — So I can deploy the fix directly
2. **Or confirm you can upload files** — I'll provide the deployment package
3. **Vercel project name for the OTHER repo** — So I never confuse them again
4. **Decision on unified deployment** — Vercel-only vs keep dual setup

The fix is in the repo. The backend file `dist-server/app.cjs` is built and ready.

**Next step:** Tell me how you want to deploy to Hostinger, and I'll guide you through it or do it for you.