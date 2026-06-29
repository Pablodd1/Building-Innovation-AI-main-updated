# BUILDINGAPP.US PRE-MORTEM ANALYSIS
## "Why Morton Will Crash at 2AM" — Engineering Failure Prediction Report
### Generated: 2026-05-25 | Scope: Full-stack (React 19 SPA + Express + PostgreSQL/MySQL + Hostinger cPanel)

================================================================================
1. ARCHITECTURE SNAPSHOT
================================================================================

Frontend:    React 19 SPA (Vite), single App.tsx (~23KB), enum-based view switching
Backend:     Express.js monolith, server/index.ts (~127KB, 3,211 lines)
Database:    PostgreSQL (preferred) / MySQL (fallback) — BUT relies heavily on JSON file fallbacks
AI:          Server-proxied Gemini (primary) / OpenAI (fallback), base64 image transport
Auth:        Session tokens (random strings), bcrypt passwords, hardcoded admin fallback
Payments:    Stripe (checkout + webhooks), mock mode when keys missing
Hosting:     Hostinger cPanel shared hosting, Node.js app deployed via Git Version Control
Images:      322 products in /products/ served statically, some via Google Drive proxy
Monitoring:  In-memory SystemMonitor, Telegram alerts, JSON audit logs
Rate Limit:  In-memory Map (per-process only)

================================================================================
2. FAILURE CATEGORIES — COMPLETE INVENTORY
================================================================================

CATEGORY A: SECURITY (Immediate Exploitation Risk)
--------------------------------------------------

[A1] HARDCODED ADMIN CREDENTIALS + UNIVERSAL ADMIN TOKEN
     Severity: CRITICAL | Likelihood: 100% (already deployed)
     Location: server/index.ts lines 729-731, 774-776, 2260-2271
     Issue:    `token === 'session_admin_fallback'` bypasses ALL auth checks.
               `admin@gmail.com` / `admin@@@1` hardcoded in login handler.
               The admin token is in GitHub source (public repo Pablodd1).
               Anyone on the internet can curl with `?token=session_admin_fallback`
               and gain full admin access to /api/admin/*, user data, analytics.
     Impact:   Complete data breach. All 322 products, all users, purchase requests,
               audit logs, config keys exposed to anyone who reads the code.
     Root:     Developer convenience token left in production.
     Detection: `grep -n "session_admin_fallback" server/index.ts` returns 6 hits.

[A2] CORS WIDE OPEN — ANY ORIGIN CAN HIT THE API
     Severity: HIGH | Likelihood: Active
     Location: server/index.ts line 809
     Issue:    `app.use(cors())` with no origin whitelist. Attackers can host
               a phishing page that calls /api/auth/signup, /api/ai/generate-overlay,
               or /api/checkout/create-session from any domain.
     Impact:   CSRF-style attacks, credential stuffing via attacker sites,
               API key burning from third-party domains.
     Root:     Default CORS configuration left in place.

[A3] NO INPUT VALIDATION ON AI ENDPOINTS — 50MB BASE64 BOMBS
     Severity: HIGH | Likelihood: High under traffic
     Location: server/index.ts lines 1518, 1590
     Issue:    `express.json({limit: '50mb'})` accepts any payload. No image
               dimension validation, no MIME type verification beyond regex,
               no file size limits per-request. An attacker can upload a 50MB
               "image" that is actually random data, burning Gemini API quota
               and causing memory spikes.
     Impact:   API key exhaustion ($$$), server OOM on shared hosting (512MB-1GB RAM),
               potential DoS.
     Root:     Trusting client-side validation; no server-side sanitization.

[A4] IMAGE PROXY IS AN OPEN PROXY + DoS AMPLIFIER
     Severity: HIGH | Likelihood: Active
     Location: server/index.ts lines 3120-3147
     Issue:    `/api/proxy-image?url=ANY_URL` fetches arbitrary URLs with no
               rate limiting, no domain whitelist, no size cap. Can proxy to
               internal services, fetch massive files, or be used to attack
               third parties with Hostinger's IP.
     Impact:   IP reputation damage, bandwidth overage charges, SSRF risk,
               potential legal liability for traffic generated.
     Root:     Proxy built for Google Drive without restrictions.

[A5] TELEGRAM ALERTS LEAK ADMIN DASHBOARD TOKENS IN MESSAGES
     Severity: MEDIUM | Likelihood: Active
     Location: server/index.ts lines 697-704, 2185, 2233
     Issue:    Telegram messages contain `<a href="https://buildingapp.us/api/admin/dashboard?token=***">`
               which is malformed HTML (unclosed string) but still reveals the
               dashboard path and suggests token exposure. Telegram messages
               are not end-to-end encrypted for bot traffic.
     Impact:   Admin dashboard URL enumeration, potential token exposure.
     Root:     Copy-paste template with placeholder not properly escaped.

[A6] DEBUG ENDPOINT EXPOSES INTERNAL FILE STRUCTURE
     Severity: MEDIUM | Likelihood: Active
     Location: server/index.ts lines 2901-2978
     Issue:    `/api/debug` lists cwd, files, data directory contents, env var
               presence flags, database connection status. No auth required.
     Impact:   Reconnaissance for attackers. Reveals server layout, whether
               .env exists, whether DB is connected.
     Root:     Debug endpoint left exposed in production.

[A7] SESSION TOKENS NEVER EXPIRE + NO INVALIDATION MECHANISM
     Severity: MEDIUM | Likelihood: Active
     Location: server/index.ts login/signup handlers
     Issue:    Session tokens are random strings stored in DB/JSON. No TTL,
               no refresh token rotation, no logout endpoint that invalidates
               the token. Stolen token is valid forever.
     Impact:   Persistent session hijacking. If token leaks (XSS, logs, network),
               attacker has permanent access.
     Root:     No session lifecycle management implemented.

[A8] PASSWORD RESET FLOW DOES NOT EXIST
     Severity: MEDIUM | Likelihood: N/A
     Issue:    Users who forget passwords have no recovery path. No /api/auth/
               forgot-password or reset-password endpoint.
     Impact:   Support burden, user churn, potential social engineering attacks
               on support channels.

--------------------------------------------------------------------------------
CATEGORY B: DATA INTEGRITY & RACE CONDITIONS (Silent Corruption)
--------------------------------------------------------------------------------

[B1] JSON FILE FALLBACKS WITH SYNCHRONOUS WRITES — NO FILE LOCKING
     Severity: CRITICAL | Likelihood: 100% under concurrent load
     Location: server/index.ts lines 583-593 (saveToJSON), used by signup,
               quota increment, tier update, material CRUD, audit logging
     Issue:    `fs.writeFileSync` is called on every user signup, every AI
               generation quota update, every admin action. There is NO file
               locking, NO atomic write pattern (write to temp + rename),
               NO queue. Two concurrent requests = corrupted JSON.
               Hostinger shared hosting may have slower disk I/O, increasing
               the race window.
     Impact:   Under 10x traffic: guaranteed data corruption. users.json becomes
               unreadable = all user data lost. products.json corrupted =
               322 product catalog destroyed. audit_logs.json corrupted =
               compliance evidence lost.
     Root:     JSON fallbacks designed for "developer convenience" without
               concurrency safety. Shared hosting = single Node process but
               still has event-loop interleaving between async boundaries.
     Detection: `saveToJSON` has zero try/catch around the write itself.
               Silent failure possible.

[B2] QUOTA INCREMENTS ARE READ-MODIFY-WRITE (NON-ATOMIC)
     Severity: HIGH | Likelihood: High under load
     Location: server/index.ts lines 2850-2899 (checkAndIncrementQuota)
     Issue:    In JSON fallback mode: read users.json, find user, increment
               generations_used, write users.json. Two simultaneous AI requests
               from the same user can both read the same value, both increment,
               and the second write overwrites the first = quota bypass.
     Impact:   Free-tier users get unlimited generations. Revenue loss.
               API key exhaustion. Quota enforcement becomes meaningless.
     Root:     No atomic counter operation in file-based storage.

[B3] AUDIT LOGS APPENDED VIA read-parse-unshift-write IN FULL
     Severity: HIGH | Likelihood: High under admin activity
     Location: server/index.ts lines 666-712 (logAdminAction)
     Issue:    Every admin action reads the ENTIRE audit_logs.persistent.json,
               parses it, unshifts a new entry, limits to 1000, then writes
               the ENTIRE file back synchronously. File size grows until capped.
               With 1000 entries at ~500 bytes each = 500KB read+write per action.
     Impact:   Admin dashboard becomes unusably slow. Event loop blocked for
               10-50ms per admin action. Under burst admin activity, requests
               queue and timeout.
     Root:     Using JSON file as an append-only log instead of a real log
               stream or database.

[B4] STRIPE WEBHOOK HANDLER HAS PARTIAL UPDATE FAILURE
     Severity: MEDIUM | Likelihood: Medium
     Location: server/index.ts lines 844-878
     Issue:    Webhook handler updates DB first, then updates JSON fallback.
               If DB succeeds but JSON fails (disk full, race condition), the
               two data stores are inconsistent. On next DB failure, the app
               reads stale JSON tier data and downgrades the user.
     Impact:   Paying customers demoted to free tier. Support tickets.
               Revenue loss and user trust damage.
     Root:     Dual-write pattern without transaction or consistency guarantee.

[B5] MATERIAL DELETE SYNC HAS RACE CONDITION BETWEEN DB AND JSON
     Severity: MEDIUM | Likelihood: Medium
     Location: server/index.ts lines 1749-1816
     Issue:    Deletes from DB, then queries ALL materials to rewrite JSON,
               then syncs to tracked JSON. Three separate I/O operations with
               no transaction. Concurrent delete requests can leave orphaned
               records in one store but not the other.
     Impact:   Ghost products appearing/disappearing between page refreshes.
               Admin confusion. Catalog inconsistency.

--------------------------------------------------------------------------------
CATEGORY C: PERFORMANCE & BOTTLENECKS (Death by Scale)
--------------------------------------------------------------------------------

[C1] BASE64 IMAGE TRANSPORT = 33% MEMORY OVERHEAD + BLOAT
     Severity: HIGH | Likelihood: Immediate under any image upload
     Location: Frontend upload, /api/ai/generate-overlay, /api/ai/analyze-room
     Issue:    Every image is base64-encoded in JSON. A 10MB JPEG becomes
               ~13.3MB base64 string inside a JSON body. With 50MB limit,
               max ~37MB raw image. On shared hosting with 512MB-1GB RAM,
               10 concurrent AI requests = 130MB+ just in request bodies,
               plus Node/V8 overhead = OOM kill.
     Impact:   Server crashes under moderate load. Hostinger may suspend
               account for excessive resource usage.
     Root:     Base64 is convenient but wrong for large binary payloads.
               Should use multipart/form-data with streaming.

[C2] SINGLE REACT COMPONENT WITH ALL STATE (23KB App.tsx)
     Severity: MEDIUM | Likelihood: Immediate on complex renders
     Location: src/App.tsx
     Issue:    All application state lives in one component. Any state change
               (e.g., cart quantity) triggers re-render of the entire app tree.
               No React.memo, no code splitting by view, no lazy loading.
     Impact:   UI freezes on mobile devices. Jank during AI image generation
               (large base64 strings in state cause massive GC pressure).
     Root:     Rapid prototyping without architectural separation.

[C3] NO CACHING LAYER FOR MATERIALS / PRODUCTS
     Severity: MEDIUM | Likelihood: Every request
     Location: /api/materials, getMaterials()
     Issue:    Every page load calls `SELECT * FROM materials ORDER BY category, name`
               or reads products.json from disk. No Redis, no in-memory cache,
               no HTTP cache headers. 322 products × every user × every session.
     Impact:   Unnecessary DB load. On Hostinger shared hosting, DB connections
               are limited and slow. Page load latency increases linearly.
     Root:     No caching strategy implemented.

[C4] 322 PRODUCT IMAGES SERVED FROM SHARED HOSTING — NO CDN
     Severity: MEDIUM | Likelihood: Every page load
     Location: /products/ static directory
     Issue:    All product images served from Hostinger's single server.
               No CloudFront, no Cloudflare, no image optimization.
               Each product page may load 10-20 thumbnails.
     Impact:   Bandwidth overage on Hostinger plan. Slow page loads for users
               outside US. Server CPU spent serving static files instead of API.
     Root:     Images stored locally for Git deployment convenience.

[C5] IN-MEMORY RATE LIMITER = PER-PROCESS ONLY
     Severity: MEDIUM | Likelihood: Immediate if multi-process
     Location: server/index.ts lines 1033-1055
     Issue:    Rate limit state lives in a Map. If Hostinger spawns multiple
               Node processes (PM2 cluster, or just app restarts), each process
               has its own counter. A determined attacker can bypass limits by
               triggering process rotation or using multiple connections.
     Impact:   Rate limiting is illusory. DoS possible by distributing requests.
     Root:     In-memory state cannot be shared across processes.

--------------------------------------------------------------------------------
CATEGORY D: RELIABILITY & SPOF (Single Points of Failure)
--------------------------------------------------------------------------------

[D1] SINGLE EXPRESS PROCESS — ONE CRASH = FULL OUTAGE
     Severity: HIGH | Likelihood: Medium (uncaught exceptions)
     Location: server/index.ts line 3191
     Issue:    One Node process. No PM2, no cluster mode, no health-check
               restarts configured in the code. An unhandled exception or OOM
               kills the app until Hostinger auto-restarts it (if configured).
     Impact:   Complete downtime for minutes per crash. No zero-downtime deploys.
     Root:     Single-process design on shared hosting.

[D2] NO TIMEOUT ON AI PROVIDER CALLS
     Severity: HIGH | Likelihood: High (AI provider latency spikes)
     Location: generateOverlay() and analyzeRoom() in server/index.ts and
               services/geminiService.ts
     Issue:    fetch() to Gemini/OpenAI has no AbortController timeout.
               A hung AI request holds an Express connection open indefinitely.
               With PostgreSQL pool connections tied to requests, this exhausts
               both HTTP and DB connection pools.
     Impact:   Cascading failure: slow AI -> connection pool exhaustion ->
               all other endpoints (login, materials, health) timeout ->
               full outage perceived by users.
     Root:     Default fetch() behavior with no timeout configured.

[D3] TELEGRAM ALERTS FIRE SYNCHRONOUSLY AND BLOCK
     Severity: MEDIUM | Likelihood: High when Telegram API is slow
     Location: server/index.ts lines 699-707, 2993-3000, trackError()
     Issue:    `await telegramAlerts.sendMessage()` is called directly from
               request handlers and error trackers. No fire-and-forget, no
               timeout, no circuit breaker. If Telegram is down or rate-limits
               the bot, the request handler hangs until the HTTP call times out
               (default: 2 minutes in Node fetch).
     Impact:   Every error or admin action becomes a 2-minute hang. The app
               appears completely down during Telegram outages.
     Root:     Alerts treated as synchronous dependencies instead of best-effort.

[D4] POSTGRESQL CONNECTION POOL WITH NO LIMITS
     Severity: MEDIUM | Likelihood: High under load
     Location: server/db.ts (not read yet, but implied by query() usage)
     Issue:    The `new Pool()` likely uses default settings (max 10 connections).
               Under AI generation load with no timeouts, connections are held
               open. If max is reached, new requests queue and timeout.
     Impact:   "Database unavailable" fallback triggers even when DB is fine,
               causing JSON fallback writes and data corruption (see B1).
     Root:     No pool configuration tuning for shared hosting constraints.

[D5] ALL ADMIN DASHBOARD HTML BAKED INTO server/index.ts
     Severity: LOW-MEDIUM | Likelihood: N/A
     Location: server/index.ts lines 1160-1264
     Issue:    104 lines of HTML template string in the API server file.
               Any dashboard UI change requires server restart.
     Impact:   Maintenance burden. UI bugs in admin dashboard require full
               server restart to fix.
     Root:     Convenience over separation of concerns.

--------------------------------------------------------------------------------
CATEGORY E: MEMORY LEAKS & RESOURCE EXHAUSTION
--------------------------------------------------------------------------------

[E1] generationLog AND errorLog ARRAYS GROW UNBOUNDED
     Severity: HIGH | Likelihood: Continuous
     Location: server/index.ts lines 1329-1339, 2980-2988
     Issue:    `generationLog` is an in-memory array. Every successful/failed
               AI generation pushes to it. No pruning except slicing in the
               analytics endpoint (which reads from the same array). Over a
               busy day with 1000 generations, this array holds 1000 objects
               with large strings forever.
     Impact:   Memory grows monotonically until OOM. Node process crashes.
               Hostinger may suspend for excessive RAM usage.
     Root:     In-memory logging without size bounds or eviction policy.

[E2] BASE64 IMAGES STORED IN REQUEST BODY AND STATE
     Severity: MEDIUM | Likelihood: Every generation
     Location: /api/ai/generate-overlay, frontend state
     Issue:    Base64 image strings are held in request body, then in
               generationLog, then possibly in response JSON. V8 heap
               fragmentation from large strings causes GC pauses.
     Impact:   Server latency spikes. UI jank. Eventually OOM.
     Root:     Base64 is not a streaming-friendly format.

[E3] AUDIT LOG JSON PARSED INTO MEMORY ON EVERY ADMIN ACTION
     Severity: MEDIUM | Likelihood: Every admin action
     Location: server/index.ts lines 680-692
     Issue:    `JSON.parse(fs.readFileSync(...))` of a 500KB+ file on every
               admin mutation. Parsed into JS objects in V8 heap. Frequent
               large allocations trigger aggressive GC.
     Impact:   Event loop blocking + GC pressure = request latency spikes.
     Root:     Using JSON file as database.

================================================================================
3. TOP 5 CRITICAL RISKS — FIX THIS WEEK
================================================================================

RANK | RISK                          | WHY #1 | FIX EFFORT | BUSINESS IMPACT
-----|-------------------------------|--------|------------|----------------
  1  | [A1] Hardcoded Admin Token    | Anyone | 30 min     | TOTAL BREACH
     |                               | can    |            | All data exposed
     |                               | become |            |
     |                               | admin  |            |
-----|-------------------------------|--------|------------|----------------
  2  | [B1] JSON File Race Corrupt   | Under  | 2 hours    | DATA LOSS
     |                               | ANY    |            | Users/products
     |                               | load,  |            | vanish/corrupt
     |                               | JSON   |            |
     |                               | dies   |            |
-----|-------------------------------|--------|------------|----------------
  3  | [C1] Base64 Image OOM +       | 10     | 4 hours    | OUTAGE
     |     No AI Timeout             | conc.  |            | Server kills
     |                               | reqs   |            | under normal
     |                               | = OOM  |            | marketing load
-----|-------------------------------|--------|------------|----------------
  4  | [A3] No Input Validation on   | Attacker| 2 hours   | $$$ LOSS
     |     AI Endpoints              | can    |            | API key drained
     |                               | burn   |            | in minutes
     |                               | keys   |            |
-----|-------------------------------|--------|------------|----------------
  5  | [D2] No AI Timeout = Cascade  | One    | 1 hour     | FULL OUTAGE
     |     Failure                   | slow   |            | All endpoints
     |                               | AI req |            | freeze together
     |                               | kills  |            |
     |                               | all    |            |

================================================================================
4. 30-DAY HARDENING PLAN
================================================================================

WEEK 1 — "STOP THE BLEEDING" (Days 1-7)
-----------------------------------------
Day 1: Remove `session_admin_fallback` token and hardcoded admin credentials.
        Add env-based admin bootstrap only on first run.
Day 2: Replace JSON file fallbacks with SQLite (file-based, atomic, single-file).
        SQLite ships with Node (better-sqlite3) and works on Hostinger.
Day 3: Add input validation to /api/ai/* — max image size (5MB), max dimensions
        (4096x4096), MIME type whitelist (jpeg, png, webp), AbortController timeout.
Day 4: Restrict CORS to buildingapp.us origins only.
Day 5: Add connection pool limits (max 5, idleTimeoutMillis: 30000) and
        request timeout middleware (30s max).
Day 6: Cap in-memory logs at 100 entries with FIFO eviction. Move audit logs
        to append-only text file (line-delimited JSON) instead of rewrite.
Day 7: Deploy Week 1 fixes to staging, run load test (10 concurrent users).

WEEK 2 — "DEFENSE IN DEPTH" (Days 8-14)
-----------------------------------------
Day 8: Add rate limiting per user (not just per IP) using Redis or SQLite counter.
Day 9: Implement multipart/form-data image upload to replace base64 transport.
        Stream images to AI provider instead of buffering in memory.
Day 10: Add CSRF tokens for state-changing mutations.
Day 11: Create password reset flow with time-limited tokens emailed via Brevo.
Day 12: Add session expiration (24h) and logout endpoint that clears token.
Day 13: Restrict /api/proxy-image to Google Drive domains only, add 5MB size cap.
Day 14: Security audit: run `npm audit`, update all dependencies with CVEs.

WEEK 3 — "SCALE PREP" (Days 15-21)
-----------------------------------
Day 15: Add Redis or in-memory LRU cache for /api/materials (5-min TTL).
Day 16: Implement PM2 cluster mode or add process manager with auto-restart.
Day 17: Split server/index.ts into routes/ directory (materials, auth, ai, admin).
Day 18: Add health check endpoint that validates DB + AI key + disk space.
Day 19: Set up Cloudflare in front of Hostinger (free tier = CDN + DDoS protection).
Day 20: Optimize product images: convert to WebP, create 300px thumbnails.
Day 21: Add lazy loading + React.memo to App.tsx views. Split by route.

WEEK 4 — "OBSERVABILITY" (Days 22-30)
--------------------------------------
Day 22: Add structured logging (Winston/Pino) to replace console.log.
Day 23: Create Sentry account for error tracking (free tier).
Day 24: Add Prometheus metrics: request rate, error rate, latency histograms.
Day 25: Build automated backup script for SQLite DB + products/ images.
Day 26: Add email alert for disk space > 80% (Hostinger limits are tight).
Day 27: Document runbook: "What to do when the site is down" (rollback steps,
        contact Hostinger, restart Node, check logs).
Day 28: Load test with 50 concurrent users using k6 or Artillery.
Day 29: Review all env vars and secrets — rotate any exposed keys.
Day 30: Schedule monthly pre-mortem review. Set calendar reminder.

================================================================================
5. MONITORING CHECKS TO ADD TODAY
================================================================================

Check Name                | Command / Endpoint          | Alert If          | How
--------------------------|----------------------------|-------------------|------------------
Admin token exposed       | grep "session_admin_fallback"| Returns any hit   | CI/CD gate
                          | server/index.ts            |                   |
--------------------------|----------------------------|-------------------|------------------
Site responds             | curl -s https://buildingapp| Status != 200     | Cron every 1 min
                          | .us/api/health             | OR > 3s latency   | Telegram alert
--------------------------|----------------------------|-------------------|------------------
Disk space                | df -h /home                | > 85% used        | Cron every 5 min
--------------------------|----------------------------|-------------------|------------------
AI API key valid          | curl /api/ai/generate      | Returns 500 or    | Cron every 10 min
                          | -overlay (test payload)    | "not configured"  | Telegram alert
--------------------------|----------------------------|-------------------|------------------
JSON file corruption      | node -e "JSON.parse(        | Throws SyntaxError| Cron every 5 min
                          | fs.readFileSync(           |                   | Telegram alert
                          | 'data/users.persistent.json'))" |               |
--------------------------|----------------------------|-------------------|------------------
Memory usage              | ps -o rss= -p <node_pid>   | RSS > 400MB       | Cron every 2 min
                          |                            |                   | Telegram alert
--------------------------|----------------------------|-------------------|------------------
Error rate spike          | tail -n 100 logs/error.log | > 10 errors/5min  | Telegram alert
                          | | grep ERROR               |                   |
--------------------------|----------------------------|-------------------|------------------
Stripe webhook delivery   | Stripe Dashboard ->        | Failure rate > 5% | Stripe emails
                          | Webhooks -> logs           |                   |
--------------------------|----------------------------|-------------------|------------------
DB connection health      | SELECT 1 via /api/health   | DB = fallback     | Telegram alert
                          | or direct psql             | for > 5 min       |

================================================================================
6. REFACTORED CODE — WORST OFFENDER: AUTH + JSON RACE CONDITIONS
================================================================================

The worst offender is the combination of [A1] hardcoded admin bypass and [B1]
JSON file writes without atomicity. Below is a refactored auth middleware +
atomic JSON helper that fixes both issues without changing functionality.

---
FILE: server/utils/atomicJSON.ts (NEW)
---

import fs from 'fs';
import path from 'path';

const lockMap = new Map<string, Promise<void>>();

async function acquireLock(filePath: string): Promise<() => void> {
    while (lockMap.has(filePath)) {
        await lockMap.get(filePath);
    }
    let release: () => void;
    const lockPromise = new Promise<void>((resolve) => { release = resolve; });
    lockMap.set(filePath, lockPromise);
    return () => {
        lockMap.delete(filePath);
        release!();
    };
}

export async function atomicReadJSON<T>(filePath: string): Promise<T> {
    const release = await acquireLock(filePath);
    try {
        if (!fs.existsSync(filePath)) return [] as unknown as T;
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        console.error(`Failed to read ${filePath}:`, e);
        return [] as unknown as T;
    } finally {
        release();
    }
}

export async function atomicWriteJSON(filePath: string, data: any): Promise<boolean> {
    const release = await acquireLock(filePath);
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const tmpPath = filePath + '.tmp';
        fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tmpPath, filePath); // Atomic on POSIX
        return true;
    } catch (e) {
        console.error(`Failed to write ${filePath}:`, e);
        return false;
    } finally {
        release();
    }
}

---
FILE: server/middleware/auth.ts (NEW)
---

import { Request, Response, NextFunction } from 'express';
import { query } from '../db';
import { atomicReadJSON } from '../utils/atomicJSON';

const JSON_USERS_PATH = process.env.JSON_USERS_PATH || './data/users.persistent.json';

interface User {
    id: number;
    name: string;
    email: string;
    role: string;
    tier: string;
    generations_used: number;
    session_token: string;
}

async function resolveUser(token: string): Promise<User | null> {
    if (!token || token.length < 10) return null;

    // 1. Try PostgreSQL first
    try {
        const result = await query(
            'SELECT id, name, email, phone, address, role, tier, generations_used, session_token FROM users WHERE session_token = $1',
            [token]
        );
        if (result.rows.length > 0) return result.rows[0] as User;
    } catch (dbErr) {
        // DB down — fall through to JSON
    }

    // 2. JSON fallback (atomic read)
    try {
        const users = await atomicReadJSON<any[]>(JSON_USERS_PATH);
        return users.find((u: any) => u.session_token === token) || null;
    } catch (e) {
        return null;
    }
}

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
    try {
        let token = '';
        if (req.headers.authorization?.startsWith('Bearer ')) {
            token = req.headers.authorization.substring(7);
        } else if (req.query.token) {
            token = req.query.token as string;
        }

        if (!token) {
            return res.status(401).json({ error: 'Unauthorized. No session token provided.' });
        }

        const user = await resolveUser(token);
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized. Invalid session token.' });
        }

        (req as any).user = user;
        next();
    } catch (error: any) {
        console.error('requireAuth middleware error:', error);
        res.status(500).json({ error: 'Internal server error during authorization' });
    }
};

export const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
    try {
        let token = '';
        if (req.headers.authorization?.startsWith('Bearer ')) {
            token = req.headers.authorization.substring(7);
        } else if (req.query.token) {
            token = req.query.token as string;
        }

        if (!token) {
            return res.status(401).json({ error: 'Unauthorized. No session token provided.' });
        }

        const user = await resolveUser(token);
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized. Invalid session token.' });
        }

        if (user.role !== 'admin') {
            return res.status(403).json({ error: 'Forbidden. Admin privileges required.' });
        }

        (req as any).user = user;
        next();
    } catch (error: any) {
        console.error('requireAdmin middleware error:', error);
        res.status(500).json({ error: 'Internal server error during authorization' });
    }
};

// --- BOOTSTRAP ADMIN (run once on server start, not hardcoded) ---
let adminBootstrapped = false;
export async function bootstrapAdmin() {
    if (adminBootstrapped) return;
    adminBootstrapped = true;

    const adminEmail = process.env.ADMIN_EMAIL || 'admin@buildingapp.us';
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminPassword) {
        console.warn('[AUTH] ADMIN_PASSWORD not set. No bootstrap admin created.');
        return;
    }

    try {
        const existing = await query('SELECT id FROM users WHERE email = $1', [adminEmail]);
        if (existing.rows.length === 0) {
            const bcrypt = await import('bcryptjs');
            const hash = await bcrypt.hash(adminPassword, 10);
            const token = 'boot_' + require('crypto').randomBytes(32).toString('hex');
            await query(
                `INSERT INTO users (name, email, password_hash, role, tier, session_token)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                ['System Admin', adminEmail, hash, 'admin', 'Enterprise', token]
            );
            console.log(`[AUTH] Bootstrap admin created: ${adminEmail}`);
        }
    } catch (e) {
        console.warn('[AUTH] Bootstrap admin failed (DB may be unavailable):', e);
    }
}

---
WHAT THESE FIXES CHANGE:
------------------------
1. REMOVED: `session_admin_fallback` string check (gone entirely).
2. REMOVED: `admin@gmail.com` / `admin@@@1` hardcoded credentials.
3. ADDED:   Admin is created ONCE from env vars (ADMIN_EMAIL + ADMIN_PASSWORD).
4. ADDED:   JSON writes use atomic temp-file + rename pattern.
5. ADDED:   Async file locking queue prevents race conditions.
6. ADDED:   Token minimum length validation (10 chars) to prevent empty bypass.

WHAT THEY DON'T CHANGE:
-----------------------
- All existing API routes and response shapes remain identical.
- JSON fallback behavior is preserved (just safe now).
- DB-first lookup order is preserved.
- All frontend code works without modification.

================================================================================
7. QUICK-WIN COMMAND CHEAT SHEET
================================================================================

# 1. Verify admin token exposure (do this NOW)
grep -n "session_admin_fallback" server/index.ts

# 2. Check if .env has real admin password (should not be in repo)
grep -n "ADMIN_PASSWORD" .env 2>/dev/null || echo "No ADMIN_PASSWORD in .env"

# 3. Monitor JSON file sizes (if these grow fast, corruption is imminent)
ls -lh data/*.json

# 4. Check Node memory usage on Hostinger
ps -o pid,rss,comm -p $(pgrep -f "node.*server")

# 5. Test if AI endpoint accepts garbage (should reject)
curl -X POST https://buildingapp.us/api/ai/analyze-room \
  -H "Content-Type: application/json" \
  -d '{"image":"'$(python3 -c "print('A'*50000000)")'","userId":1}'

# 6. Verify CORS is wide open (should be restricted)
curl -I -X OPTIONS https://buildingapp.us/api/health \
  -H "Origin: https://evil.com" \
  -H "Access-Control-Request-Method: POST"

================================================================================
END OF PRE-MORTEM REPORT
================================================================================
Next step: Apply fixes or schedule deployment. Recommend Week 1 fixes be
deployed within 48 hours due to [A1] and [B1] being actively exploitable.
