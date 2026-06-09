# Postmortem: buildingapp.us — Render Fidelity + Admin Audit

**Date:** 2026-06-09
**Author:** Hermes Agent (DeepSeek V4 Pro)
**Project:** Building Innovation AI (buildingapp.us)
**Commit:** 9394e4f (current on Hostinger via auto-deploy)

---

## Summary

Conducted full production audit of buildingapp.us. Found 3 critical issues preventing admin functionality and render operations from working. Product image quality was already fixed (quality 95 WebP). Gemini render model fixed (gemini-2.5-flash). However, admin panel is broken because all admin API calls lack authorization headers, making the users table, settings, analytics, and admin functions inoperative.

---

## What Was Checked

| Area | Status | Finding |
|------|--------|---------|
| Site availability | ✅ | HTTP 200 on all routes |
| Product images | ✅ | 317 images at quality 95 (200-582 KB complex textures) |
| Render pipeline | ✅ | Gemini 2.5-flash model active, DALL-E fake fallback removed |
| Product DB | ✅ | 322 products visible in admin |
| **Admin users table** | ❌ | Empty — API returns 401 silently |
| **Admin settings** | ❌ | GEMINI_API_KEY empty, credentials not loaded |
| **Demo user** | ⚠️ | Functions as viewer, but has no server session token |
| **User signup** | ✅ | API works (tested: test@example.com created successfully) |

---

## What Went Wrong ❌

### P0: Admin Panel Broken — All API Calls Fail with 401

**Root cause:** The frontend `fetchAllUsers()`, `fetchAnalytics()`, `fetchAuditLogs()`, and `fetchSecureConfig()` make bare fetch calls with NO Authorization header. The server's `requireAdmin` middleware requires `Bearer <token>`. Since no token is sent, ALL admin API calls return 401.

**Affected lines in App.tsx:**
- L507: `fetch('/api/admin/analytics')` — no auth header
- L522: `fetch("/api/admin/users")` — no auth header
- L537: `fetch("/api/admin/audit-logs")` — no auth header
- L551: `fetch("/api/admin/config")` — no auth header

**Impact:**
- Users table stays empty (allUsers state never populated)
- Settings page shows placeholder values instead of saved config
- Analytics never load
- Admin cannot manage users, tiers, or generations

**Demo user exacerbates this:** The "Skip for now (Demo)" button creates a local-only user object (`id: 0, role: 'admin'`) with NO session_token. Even if the frontend sent auth headers, the demo user has no valid server-side token.

### P0: GEMINI_API_KEY Empty — Renders Will Fail

**Root cause:** Settings page shows placeholder "AIzaSy..." in the Gemini key field. The API key is stored in `data/config.json` and needs to be set. Without it, all overlay/render operations fail with "Gemini API Key not configured."

**Impact:** The entire core product feature (AI material overlay on user photos) is non-functional for all providers because:
- Gemini: no key configured
- OpenAI: path removed (GPT-4o can't output images)

### P2: Tailwind CDN in Production

**Root cause:** App.tsx loads Tailwind CSS from `cdn.tailwindcss.com` instead of using a PostCSS build. This adds unnecessary download size and causes the console warning.

---

## What Went Well ✅

1. **Git auto-deploy working** — Commits push to GitHub → Hostinger pulls automatically → Passenger restarts on `restart.txt`
2. **Product image quality** — 317 images re-converted to WebP quality 95, complex textures 200-582 KB
3. **Render pipeline fix** — Gemini model corrected to gemini-2.5-flash, DALL-E fake fallback removed
4. **User signup API** — Backend correctly creates users in both PostgreSQL and JSON fallback
5. **Backend users exist** — API returns 2 users when accessed with valid token
6. **Site stability** — No JS errors, no crashes, all routes 200

---

## Root Causes

| Root Cause | Issues | Fix |
|-----------|--------|-----|
| **Missing auth headers in frontend** | P0: Admin panel broken | Add Authorization header to all admin fetch calls |
| **Demo user has no server session** | P0: Demo admin can't use admin features | Generate a real session token on demo login |
| **API key never configured** | P0: Renders broken | Set GEMINI_API_KEY in settings or env var |
| **Tailwind CDN instead of build** | P2: Console warning, perf | Migrate to PostCSS Tailwind build |

---

## Action Items

- [ ] **P0: Add auth headers to admin API calls**
  - File: `App.tsx` L507, 522, 537, 551
  - Pattern: `fetch(url, { headers: { Authorization: \`Bearer \${currentUser?.session_token}\` } })`
  - Type: prevent
  - Effort: 5 min

- [ ] **P0: Fix demo user to have valid session token**
  - File: `App.tsx` L1935-1946
  - Option A: Call `/api/auth/login` with demo credentials server-side
  - Option B: Create a demo-specific server endpoint that returns a valid admin session
  - Type: prevent
  - Effort: 15 min

- [ ] **P0: Configure GEMINI_API_KEY**
  - Set in `data/config.json` on Hostinger server
  - Or set via environment variable on Hostinger
  - Type: enable
  - Effort: 2 min (needs user's actual API key)

- [ ] **P2: Migrate Tailwind to PostCSS build**
  - Install tailwindcss + postcss + autoprefixer
  - Replace CDN script with built CSS
  - Type: cleanup
  - Effort: 15 min

---

## Lessons Learned

1. **Always test admin features with real auth** — Demo mode masks auth failures silently
2. **Auth middleware should log 401s with context** — Currently silent failures make debugging hard
3. **API calls need auth header pattern** — Should be a reusable fetch wrapper, not bare fetch
4. **Demo user should mirror real user flow** — Client-side only user breaks all server-dependent features
5. **Settings should validate on save** — Empty API keys should show a warning, not silently fail later
