# Building Innovation AI

**AI-Powered Construction Material Visualization & Estimation Platform**

[buildingapp.us](https://buildingapp.us) · [buildinginnovation.us](https://buildinginnovation.us)

---

## What It Does

Building Innovation AI lets contractors, homeowners, and architects:

1. **Take a photo** of any room
2. **Overlay construction materials** using AI (Google Gemini / OpenAI)
3. **Get exact estimates** — material quantity, waste factor, labor cost
4. **Assign a contractor** from our database
5. **Checkout with Stripe** — buy materials directly

All in a single platform. English/Spanish toggle. LATAM + USA units.

---

## Competitive Landscape

| Feature | Building Innovation AI | Hover | Planner5D | Buildxact | Procore | STACK |
|---------|----------------------|-------|-----------|-----------|---------|-------|
| AI Room Visualization | ✅ | ❌ (3D only) | ⚠️ (design gen) | ❌ | ❌ | ❌ |
| Camera Photo Capture | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| AI Room Analysis | ✅ | ✅ (measurements) | ⚠️ | ❌ | ❌ | ❌ |
| Material Estimation | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Contractor Assignment | ✅ | ⚠️ | ❌ | ⚠️ | ✅ | ❌ |
| Stripe Checkout | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Multi-Language (EN/ES) | ✅ | ❌ | ✅ (20+) | ❌ | ✅ | ❌ |
| Before/After Comparison | ✅ | ⚠️ | ✅ | ❌ | ❌ | ❌ |
| Multiple Lighting Modes | ✅ | ❌ | ⚠️ | ❌ | ❌ | ❌ |
| Free Tier with AI | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| WhatsApp Bot (planned) | 🔜 | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Price** | **Free / $9.99/mo** | $29-65/report | Free / $6.99/mo | $149/mo | ~$5K+/yr | $2,599/yr |

> **Full competitive analysis:** [building-innovation-landing.vercel.app](https://building-innovation-landing.vercel.app)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript + Vite |
| Styling | Tailwind CSS |
| Backend | Express.js (Node.js) |
| Database | PostgreSQL |
| AI | Google Gemini 2.0 / OpenAI GPT-4o |
| Payments | Stripe PaymentIntents |
| Notifications | Email (Nodemailer) + Telegram Alerts |
| Hosting | Hostinger (Node.js Passenger) + Vercel |
| Image Processing | Sharp |

---

## What Makes Us Different

1. **Only all-in-one platform** — visualization + estimation + contractor + checkout in one flow
2. **LATAM-first** — Spanish-native interface, Colombian contractor database, metric units
3. **15x cheaper** than enterprise alternatives (Procore, Buildxact, STACK)
4. **AI-agnostic** — multi-provider backend can switch between Gemini/OpenAI without code changes
5. **Free tier** — 5 real AI renders/month at $0

---

## Planned AI Features (Roadmap)

| Feature | Impact | Effort |
|---------|--------|--------|
| Voice-to-Quote (hands-free ordering) | 10x faster field quotes | Medium |
| AI Damage Assessment (insurance claims) | New revenue stream | Medium |
| AI Design Style Transfer (inspiration → product) | Viral consumer feature | Low |
| AR Live Preview (WebXR) | Highest conversion | High |
| AI Project Timeline Generator | PM-lite add-on | Low |
| WhatsApp AI Chatbot for Quotes | 10x LATAM user base | Medium |

---

## Pricing

| Tier | Price | AI Renders | Features |
|------|-------|-----------|----------|
| Free | $0/mo | 5/month | Browse catalog, basic estimation |
| Premium | $9.99/mo | 50/month | Full estimation, contractor, Stripe |
| Elite | $19.99/mo | Unlimited | Priority AI, PDF export, all features |

---

## Repository Structure

```
├── App.tsx                    # Main React application
├── components/                # Reusable UI components
│   ├── CameraCapture.tsx      # In-app photo capture
│   ├── EstimationPanel.tsx    # Material quantity calculator
│   ├── ImageComparator.tsx    # Before/after side-by-side
│   └── AdminPurchaseQueue.tsx # Purchase management
├── server/
│   ├── index.ts               # Express.js server
│   ├── services/aiProviders.ts # Multi-provider AI abstraction
│   ├── emailService.ts        # Purchase notifications
│   └── telegramAlerts.ts      # Crash/order Telegram alerts
├── services/
│   └── geminiService.ts       # Client-side AI service layer
├── constants.ts               # Materials, contractors, translations
└── types.ts                   # TypeScript type definitions
```

---

## Environment Variables

```
AI_PROVIDER=gemini|openai
GEMINI_API_KEY=xxx
OPENAI_API_KEY=xxx
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
DATABASE_URL=postgresql://...
DB_HOST=xxx
DB_USER=xxx
DB_PASSWORD=xxx
DB_NAME=xxx
TELEGRAM_BOT_TOKEN=xxx
TELEGRAM_CHAT_ID=xxx
```

---

## Deploy

```bash
npm run build
# Frontend → Vercel (auto-deploy on git push)
# Backend → Hostinger (via PHP FTP bridge or Passenger)
```

---

*Building Innovation AI — Visualize. Estimate. Build.*
