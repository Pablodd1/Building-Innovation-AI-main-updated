// ConstructViz AI - Express Backend Server
// Handles materials database and purchase requests

import express, { Request, Response } from 'express';
import cors from 'cors';
import pg from 'pg';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from "@google/genai";
import Stripe from 'stripe';
import { sendPurchaseNotifications } from './emailService';
import { BUILD_COMMIT, BUILD_TIME } from './buildInfo';
import { TelegramAlerts, telegramAlerts } from './telegramAlerts';
import { productionAlerts } from './productionAlerts';
import mysql from 'mysql2/promise';

// SERVER_DIR: use process.cwd() for CJS bundled output, or compute from import.meta.url for ESM dev
const SERVER_DIR = path.resolve();

// [SystemMonitor class moved to after config definitions]


// CRASH LOGGER: Captures startup errors on Hostinger
function logCrash(error: any) {
    const msg = `${new Date().toISOString()}\n${error.stack || error}\n`;
    try {
        fs.appendFileSync(path.join(process.cwd(), 'crash.log'), msg);
    } catch (e) {}
    console.error('CRITICAL STARTUP ERROR:', error);
}

try {
const PORT = process.env.PORT || 3000;
const { Pool } = pg;
const app = express();
const dbConfig = process.env.DATABASE_URL 
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: Number(process.env.DB_PORT) || 5432
    };

const isPostgres = !!(process.env.DATABASE_URL || process.env.DB_PORT === '5432');

const pool = isPostgres 
    ? new Pool({ ...dbConfig, ssl: { rejectUnauthorized: false } })
    : null;

const mysqlPool = !isPostgres 
    ? mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: Number(process.env.DB_PORT) || 3306,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    })
    : null;

// Helper to run queries on either DB
async function query(text: string, params: any[] = []) {
    if (isPostgres && pool) {
        return await pool.query(text, params);
    } else if (mysqlPool) {
        // Convert $1, $2 to ? for MySQL
        const mysqlQuery = text.replace(/\$\d+/g, '?');
        const [rows] = await mysqlPool.execute(mysqlQuery, params);
        return { rows: rows as any[] };
    }
    throw new Error('No database connection configured');
}

// In-memory error log for debugging
const errorLog: any[] = [];

const TIERS = {
    FREE: { name: 'Tier 1 (Free)', limit: 20 },
    STARTER: { name: 'Tier 2 ($10)', limit: 50 },
    PLUS: { name: 'Tier 3 ($50)', limit: 100 },
    ENTERPRISE: { name: 'Enterprise', limit: 9999 }
};

// HA VERSINE FORMULA: Calculate distance between two coordinates in km
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Run migrations on startup
async function runMigrations() {
    try {
        await query(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS tier VARCHAR(20) DEFAULT 'Free';
            ALTER TABLE users ADD COLUMN IF NOT EXISTS generations_used INTEGER DEFAULT 0;
            ALTER TABLE materials ADD COLUMN IF NOT EXISTS price_contractor DECIMAL(10, 2);
        `);
        console.log('✅ Database migrations applied');
    } catch (e: any) {
        console.warn('⚠️ Migration failed (likely no DB connection):', e.message);
    }
}
runMigrations();

const JSON_DB_PATH = fs.existsSync(path.join(process.cwd(), 'public', 'data', 'products.json'))
    ? path.join(process.cwd(), 'public', 'data', 'products.json')
    : path.join(process.cwd(), 'data', 'products.json');

const JSON_USERS_PATH = fs.existsSync(path.join(process.cwd(), 'public', 'data', 'users.json'))
    ? path.join(process.cwd(), 'public', 'data', 'users.json')
    : path.join(process.cwd(), 'data', 'users.json');

const JSON_PRODUCTS_PATH = JSON_DB_PATH;

// Try multiple paths for config — Hostinger cwd varies depending on how Node is started
const JSON_CONFIG_PATHS = [
    path.join(process.cwd(), 'data', 'config.json'),           // cwd/data
    path.resolve(SERVER_DIR, '..', 'data', 'config.json'),      // sibling to dist-server
    path.resolve(SERVER_DIR, '..', '..', 'data', 'config.json'), // two levels up
];

function findConfigPath(): string | null {
    for (const p of JSON_CONFIG_PATHS) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

const JSON_CONFIG_PATH = findConfigPath() || JSON_CONFIG_PATHS[0];

// ==================== ADMIN HEALTH & MONITORING SYSTEM ====================

interface HealthStatus {
  timestamp: string;
  uptime: number;
  version: string;
  commit: string;
  checks: {
    apiKey: { ok: boolean; message: string };
    database: { ok: boolean; message: string };
    configFile: { ok: boolean; path: string | null };
    staticFiles: { ok: boolean; distPath: string; size: number };
    serverBundle: { ok: boolean; path: string; size: number };
  };
  usage: {
    totalRequests: number;
    apiCalls: number;
    aiGenerations: number;
    materialViews: number;
    errors: number;
    startTime: string;
  };
}

class SystemMonitor {
  private startTime = Date.now();
  private counters = {
    totalRequests: 0,
    apiCalls: 0,
    aiGenerations: 0,
    materialViews: 0,
    errors: 0,
  };
  private dailyLog: any[] = [];
  private alertCooldown = new Map<string, number>();

  trackRequest(req: Request) {
    this.counters.totalRequests++;
    if (req.path.startsWith('/api')) this.counters.apiCalls++;
    if (req.path.includes('generate')) this.counters.aiGenerations++;
    if (req.path.includes('material') || req.path.includes('products')) this.counters.materialViews++;
  }

  trackError(error: any) {
    this.counters.errors++;
    // Send Telegram alert for errors
    telegramAlerts.sendErrorAlert(error instanceof Error ? error : new Error(String(error)));
  }

  async getHealth(): Promise<HealthStatus> {
    const config = await this.checkConfig();
    const db = await this.checkDatabase();
    const staticFiles = this.checkStaticFiles();
    const bundle = this.checkServerBundle();

    return {
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      version: '0.0.0',
      commit: BUILD_COMMIT,
      checks: {
        apiKey: config,
        database: db,
        configFile: { ok: !!findConfigPath(), path: findConfigPath() },
        staticFiles,
        serverBundle: bundle,
      },
      usage: {
        ...this.counters,
        totalUsers: await this.getTotalUsers(),
        startTime: new Date(this.startTime).toISOString(),
      },
    };
  }

  private async getTotalUsers(): Promise<number> {
    try {
      if (pool) {
        const res = await pool.query('SELECT COUNT(*) FROM users');
        return parseInt(res.rows[0].count);
      } else if (mysqlPool) {
        const [rows] = await mysqlPool.execute('SELECT COUNT(*) as count FROM users');
        return (rows as any)[0].count;
      }
      if (fs.existsSync(JSON_USERS_PATH)) {
        const data = fs.readFileSync(JSON_USERS_PATH, 'utf8');
        const users = JSON.parse(data);
        return Array.isArray(users) ? users.length : 0;
      }
      return 0;
    } catch (e) {
      return 0;
    }
  }

  // --- Proactive Health ---
  private lastStatus = true;
  
  async checkAndReport() {
    try {
      const health = await this.getHealth();
      const currentStatus = health.checks.apiKey.ok && health.checks.database.ok;
      
      // If status changed (Recovered or Failed)
      if (currentStatus !== this.lastStatus) {
        if (currentStatus) {
           await telegramAlerts.sendSuccessAlert("System Recovery", "API Key and Database are back online.");
        } else {
           const issues = [];
           if (!health.checks.apiKey.ok) issues.push(`AI Key: ${health.checks.apiKey.message}`);
           if (!health.checks.database.ok) issues.push(`DB: ${health.checks.database.message}`);
           await telegramAlerts.sendErrorAlert(new Error("Health Degraded"), issues.join("\n"));
        }
        this.lastStatus = currentStatus;
      }
    } catch (e) {}
  }

  private async checkConfig() {
    try {
      const configPath = findConfigPath();
      let key = null;
      
      if (configPath) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        key = config.GEMINI_API_KEY;
      }
      
      // Fallback to env var
      if (!key) {
        key = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
      }
      
      if (!key) return { ok: false, message: 'GEMINI_API_KEY not found in config or env' };
      if (!key.startsWith('AIza')) return { ok: false, message: 'API key format invalid (should start with AIza)' };
      return { ok: true, message: `Key valid (${key.length} chars)` };
    } catch (e: any) {
      return { ok: false, message: `Config error: ${e.message}` };
    }
  }

  private async checkDatabase() {
    try {
      if (isPostgres) {
        const testPool = new Pool({
          connectionString: process.env.DATABASE_URL || 'postgresql://localhost/test',
          ssl: { rejectUnauthorized: false },
        });
        await testPool.query('SELECT 1');
        await testPool.end();
        return { ok: true, message: 'PostgreSQL connected' };
      } else {
        const connection = await mysql.createConnection({
          host: process.env.DB_HOST,
          user: process.env.DB_USER,
          password: process.env.DB_PASSWORD,
          database: process.env.DB_NAME,
          port: Number(process.env.DB_PORT) || 3306,
        });
        await connection.execute('SELECT 1');
        await connection.end();
        return { ok: true, message: 'MySQL connected' };
      }
    } catch (e: any) {
      return { ok: false, message: `DB error: ${e.message}` };
    }
  }

  private checkStaticFiles() {
    const distPath = path.join(SERVER_DIR, 'dist');
    try {
      const stats = fs.statSync(distPath);
      const files = fs.readdirSync(distPath);
      return { ok: true, distPath, size: files.length };
    } catch (e: any) {
      return { ok: false, distPath, size: 0 };
    }
  }

  private checkServerBundle() {
    const bundlePath = path.join(SERVER_DIR, 'dist-server', 'app.cjs');
    try {
      const stats = fs.statSync(bundlePath);
      return { ok: true, path: bundlePath, size: Math.round(stats.size / 1024 / 1024 * 100) / 100 };
    } catch (e: any) {
      return { ok: false, path: bundlePath, size: 0 };
    }
  }

  async sendHealthAlert(): Promise<boolean> {
    const health = await this.getHealth();
    return telegramAlerts.sendHealthAlert(health);
  }

  getDailyReport() {
    const report = {
      date: new Date().toISOString().split('T')[0],
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      usage: { ...this.counters },
      health: null as any,
    };
    return report;
  }
}

const monitor = new SystemMonitor();

// Test the monitor on startup (logs to console + telegram)
setTimeout(async () => {
    const health = await monitor.getHealth();
    console.log('📊 System Health Check:', {
        apiKey: health.checks.apiKey.ok ? '✅' : '❌',
        database: health.checks.database.ok ? '✅' : '⚠️',
        staticFiles: health.checks.staticFiles.ok ? '✅' : '❌',
        serverBundle: health.checks.serverBundle.ok ? '✅' : '❌',
    });
    
    // Send startup health report to Telegram
    await telegramAlerts.sendStartupAlert(BUILD_COMMIT, Number(PORT));
    await monitor.sendHealthAlert();
}, 2000);

// Set up proactive monitoring intervals
setInterval(() => monitor.checkAndReport(), 300000); // Check every 5 mins for state changes
setInterval(() => monitor.sendHealthAlert(), 12 * 3600000); // Detailed report every 12 hours

// Helper to get config (API Keys, etc.)
async function getConfig() {
    const configPath = findConfigPath();
    try {
        if (configPath) {
            return JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }
    } catch (e) {}
    return { GEMINI_API_KEY: process.env.VITE_GEMINI_API_KEY || "" };
}

// Helper to save to JSON (fallback persistence)
function saveToJSON(filePath: string, data: any) {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error(`Error saving to ${filePath}:`, e);
        return false;
    }
}

// Helper to get materials from DB or JSON
async function getMaterials() {
    try {
        const result = await query('SELECT * FROM materials ORDER BY created_at DESC');
        return result.rows;
    } catch (e) {
        console.warn('Database unavailable, reading from local JSON manifest...');
        if (fs.existsSync(JSON_DB_PATH)) {
            const data = fs.readFileSync(JSON_DB_PATH, 'utf8');
            return JSON.parse(data);
        }
        return [];
    }
}

// Helper to get users from DB or JSON
async function getUsers() {
    try {
        const result = await query('SELECT * FROM users');
        return result.rows;
    } catch (e) {
        console.warn('Database unavailable, reading from local users fallback...');
        if (fs.existsSync(JSON_USERS_PATH)) {
            const data = fs.readFileSync(JSON_USERS_PATH, 'utf8');
            return JSON.parse(data);
        }
        return [];
    }
}

// Middleware + Monitoring + Security
app.use(cors());
// Stripe Webhook Endpoint (Must use raw body for signature verification)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_123', { apiVersion: '2025-02-24.acacia' });
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_123';

app.post('/api/webhooks/stripe', express.raw({type: 'application/json'}), async (req: Request, res: Response) => {
    const sig = req.headers['stripe-signature'] as string;
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err: any) {
        console.error(`Webhook Error: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object as any;
        const userId = session.client_reference_id;
        
        if (userId) {
            console.log(`Payment successful for user ${userId}. Upgrading tier...`);
            try {
                const tier = session.amount_total > 4000 ? 'Enterprise' : 'Pro'; // $50 = Enterprise, $10 = Pro
                await query('UPDATE users SET tier = $1 WHERE id = $2', [tier, userId]);
            } catch (e: any) {
                console.error(`Failed to upgrade tier for user ${userId}:`, e);
            }
        }
    }

    res.json({received: true});
});

app.use(express.json({ limit: '50mb' }));

// Security headers for production
app.use((req: Request, res: Response, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    next();
});

// Simple in-memory rate limiter for API endpoints
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 100; // requests per window
const RATE_WINDOW = 60 * 1000; // 1 minute

function rateLimit(req: Request, res: Response, next: Function) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const key = `${ip}:${req.path}`;
    const record = rateLimitStore.get(key);
    
    if (!record || now > record.resetTime) {
        rateLimitStore.set(key, { count: 1, resetTime: now + RATE_WINDOW });
        return next();
    }
    
    if (record.count >= RATE_LIMIT) {
        console.warn(`[RATE LIMIT] ${ip} exceeded limit for ${req.path}`);
        return res.status(429).json({ error: 'Too many requests. Please slow down.' });
    }
    
    record.count++;
    next();
}

// Apply rate limiting to API routes
app.use('/api/', rateLimit);

// Request tracking for admin dashboard + error alerts
app.use((req: Request, res: Response, next) => {
    monitor.trackRequest(req);
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        if (duration > 5000) {
            console.warn(`[SLOW] ${req.method} ${req.path} took ${duration}ms`);
        }
        if (res.statusCode >= 500) {
            monitor.trackError(new Error(`${req.method} ${req.path} returned ${res.statusCode} in ${duration}ms`));
            productionAlerts.sendErrorAlert(
                new Error(`${req.method} ${req.path} returned ${res.statusCode}`),
                `Request took ${duration}ms`
            );
        }
    });
    next();
});

// Health check
app.get('/api/health', (req: Request, res: Response) => {
    res.json({ 
        status: 'ok', 
        database: 'fallback_enabled',
        timestamp: new Date().toISOString() 
    });
});

// Build info — confirms which commit is running
app.get('/api/build', (req: Request, res: Response) => {
    res.json({
        commit: BUILD_COMMIT,
        builtAt: BUILD_TIME,
        nodeEnv: process.env.NODE_ENV || 'development',
        port: PORT,
    });
});

// ===== ADMIN HEALTH & DASHBOARD ENDPOINTS =====

// Full health status (JSON)
app.get('/api/admin/health', async (req: Request, res: Response) => {
    try {
        const health = await monitor.getHealth();
        res.json(health);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// Visual HTML dashboard
app.get('/api/admin/dashboard', async (req: Request, res: Response) => {
    try {
        const health = await monitor.getHealth();
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BuildingApp Admin Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 20px; }
        .container { max-width: 1200px; margin: 0 auto; }
        h1 { color: #fff; margin-bottom: 10px; }
        .subtitle { color: #888; margin-bottom: 30px; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .card { background: #141414; border: 1px solid #222; border-radius: 12px; padding: 20px; }
        .card h3 { color: #fff; margin-bottom: 15px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; }
        .status { display: flex; align-items: center; gap: 10px; margin: 8px 0; }
        .status-dot { width: 10px; height: 10px; border-radius: 50%; }
        .status-dot.ok { background: #22c55e; }
        .status-dot.fail { background: #ef4444; }
        .status-dot.warn { background: #f59e0b; }
        .metric { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #222; }
        .metric:last-child { border-bottom: none; }
        .metric-value { color: #fff; font-weight: 600; }
        .commit { font-family: monospace; background: #1a1a1a; padding: 4px 8px; border-radius: 4px; font-size: 12px; }
        .refresh { position: fixed; top: 20px; right: 20px; background: #2563eb; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; }
        .refresh:hover { background: #1d4ed8; }
        .uptime { font-size: 24px; font-weight: 700; color: #22c55e; }
        @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
    </style>
</head>
<body>
    <div class="container">
        <button class="refresh" onclick="location.reload()">Refresh</button>
        <h1>BuildingApp Admin Dashboard</h1>
        <p class="subtitle">Monitor your app's health, usage, and performance</p>
        
        <div class="grid">
            <div class="card">
                <h3>System Status</h3>
                <div class="status">
                    <span class="status-dot ${health.checks.apiKey.ok ? 'ok' : 'fail'}"></span>
                    <span>API Key: ${health.checks.apiKey.message}</span>
                </div>
                <div class="status">
                    <span class="status-dot ${health.checks.database.ok ? 'ok' : 'warn'}"></span>
                    <span>Database: ${health.checks.database.message}</span>
                </div>
                <div class="status">
                    <span class="status-dot ${health.checks.configFile.ok ? 'ok' : 'fail'}"></span>
                    <span>Config File: ${health.checks.configFile.path ? 'Found' : 'Missing'}</span>
                </div>
                <div class="status">
                    <span class="status-dot ${health.checks.staticFiles.ok ? 'ok' : 'fail'}"></span>
                    <span>Static Files: ${health.checks.staticFiles.size} files</span>
                </div>
                <div class="status">
                    <span class="status-dot ${health.checks.serverBundle.ok ? 'ok' : 'fail'}"></span>
                    <span>Server Bundle: ${health.checks.serverBundle.size} MB</span>
                </div>
            </div>
            
            <div class="card">
                <h3>Usage Statistics</h3>
                <div class="metric"><span>Total Requests</span><span class="metric-value">${health.usage.totalRequests.toLocaleString()}</span></div>
                <div class="metric"><span>API Calls</span><span class="metric-value">${health.usage.apiCalls.toLocaleString()}</span></div>
                <div class="metric"><span>AI Generations</span><span class="metric-value">${health.usage.aiGenerations.toLocaleString()}</span></div>
                <div class="metric"><span>Material Views</span><span class="metric-value">${health.usage.materialViews.toLocaleString()}</span></div>
                <div class="metric"><span>Errors</span><span class="metric-value" style="color:${health.usage.errors > 0 ? '#ef4444' : '#22c55e'}">${health.usage.errors.toLocaleString()}</span></div>
            </div>
            
            <div class="card">
                <h3>Build Info</h3>
                <div class="metric"><span>Commit</span><span class="commit">${health.commit}</span></div>
                <div class="metric"><span>Version</span><span class="metric-value">${health.version}</span></div>
                <div class="metric"><span>Uptime</span><span class="metric-value">${Math.floor(health.uptime / 60)}m ${health.uptime % 60}s</span></div>
                <div class="metric"><span>Server Time</span><span class="metric-value">${new Date(health.timestamp).toLocaleTimeString()}</span></div>
            </div>
            
            <div class="card">
                <h3>Quick Links</h3>
                <div class="metric"><a href="/api/health" style="color:#2563eb">/api/health</a></div>
                <div class="metric"><a href="/api/build" style="color:#2563eb">/api/build</a></div>
                <div class="metric"><a href="/api/debug/config-path" style="color:#2563eb">/api/debug/config-path</a></div>
                <div class="metric"><a href="/api/admin/health" style="color:#2563eb">/api/admin/health (JSON)</a></div>
            </div>
        </div>
        
        <p style="color:#555; text-align:center; margin-top:40px;">BuildingApp Admin Dashboard — Auto-refreshes on page reload</p>
    </div>
</body>
</html>`;
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// Daily report endpoint (for cron jobs or scheduled emails)
app.get('/api/admin/report', (req: Request, res: Response) => {
    const report = monitor.getDailyReport();
    res.json(report);
});

// Test Telegram configuration
app.get('/api/admin/test-telegram', async (req: Request, res: Response) => {
    try {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) {
            return res.status(400).json({ 
                success: false, 
                error: 'TELEGRAM_BOT_TOKEN not configured. Add it to environment variables.' 
            });
        }
        
        const result = await telegramAlerts.sendMessage({
            text: '<b>✅ BuildingApp Telegram Test</b>\n\nYour Telegram alerts are working!',
            parse_mode: 'HTML'
        });
        
        res.json({
            success: result,
            message: result ? 'Test message sent successfully' : 'Failed to send test message',
            tokenConfigured: !!token,
            chatId: process.env.TELEGRAM_CHAT_ID || '7838956683'
        });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Production status endpoint
app.get('/api/admin/status', (req: Request, res: Response) => {
    res.json({
        app: {
            name: 'BuildingApp',
            version: '0.0.0',
            commit: BUILD_COMMIT,
            nodeEnv: process.env.NODE_ENV || 'development',
            port: PORT,
            uptime: Math.floor(process.uptime()),
        },
        alerts: productionAlerts.getStatus(),
        database: {
            configured: !!process.env.DATABASE_URL,
            fallback: true,
        },
        ai: {
            provider: 'Google Gemini',
            apiKeyConfigured: true,
        },
        security: {
            headersEnabled: true,
            rateLimiting: true,
        },
        timestamp: new Date().toISOString(),
    });
});

// ===== ANALYTICS & GENERATION TRACKING =====

// In-memory generation log (persists until server restart; could be extended to DB/JSON)
const generationLog: Array<{
    timestamp: string;
    userId?: number;
    materialId?: string;
    materialName?: string;
    category?: string;
    success: boolean;
    durationMs: number;
    model: string;
    error?: string;
}> = [];

app.get('/api/admin/analytics', async (req: Request, res: Response) => {
    try {
        const health = await monitor.getHealth();
        
        // Get user stats from JSON fallback
        let userStats = { total: 0, free: 0, pro: 0, enterprise: 0, totalGenerations: 0 };
        try {
            const users = await getUsers();
            userStats.total = users.length;
            for (const u of users) {
                const tier = (u.tier || 'Free').toLowerCase();
                if (tier === 'pro') userStats.pro++;
                else if (tier === 'enterprise') userStats.enterprise++;
                else userStats.free++;
                userStats.totalGenerations += (u.generations_used || 0);
            }
        } catch (e) {}
        
        // Get product stats
        let productCount = 0;
        let categoryBreakdown: Record<string, number> = {};
        try {
            const products = loadFromJSON(JSON_PRODUCTS_PATH);
            productCount = products.length;
            for (const p of products) {
                const cat = p.category || 'Uncategorized';
                categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1;
            }
        } catch (e) {}
        
        // Top rendered materials from generation log
        const materialCounts: Record<string, { name: string; count: number; category: string }> = {};
        for (const gen of generationLog) {
            if (gen.materialId && gen.success) {
                if (!materialCounts[gen.materialId]) {
                    materialCounts[gen.materialId] = { name: gen.materialName || gen.materialId, count: 0, category: gen.category || '' };
                }
                materialCounts[gen.materialId].count++;
            }
        }
        const topMaterials = Object.entries(materialCounts)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 10)
            .map(([id, data]) => ({ id, ...data }));
        
        // Recent generations (last 20)
        const recentGenerations = generationLog.slice(-20).reverse();
        
        // Hourly generation counts (last 24h)
        const now = Date.now();
        const hourlyGenerations: Array<{ hour: string; count: number; errors: number }> = [];
        for (let i = 23; i >= 0; i--) {
            const hourStart = now - (i + 1) * 3600000;
            const hourEnd = now - i * 3600000;
            const hourLabel = new Date(hourEnd).toISOString().slice(11, 16);
            const inRange = generationLog.filter(g => {
                const t = new Date(g.timestamp).getTime();
                return t >= hourStart && t < hourEnd;
            });
            hourlyGenerations.push({
                hour: hourLabel,
                count: inRange.filter(g => g.success).length,
                errors: inRange.filter(g => !g.success).length,
            });
        }
        
        // Success rate
        const totalGens = generationLog.length;
        const successGens = generationLog.filter(g => g.success).length;
        const avgDuration = totalGens > 0 
            ? Math.round(generationLog.reduce((sum, g) => sum + g.durationMs, 0) / totalGens)
            : 0;

        res.json({
            server: {
                uptime: Math.floor(process.uptime()),
                nodeEnv: process.env.NODE_ENV || 'development',
                commit: BUILD_COMMIT,
                startTime: health.usage.startTime,
            },
            usage: health.usage,
            users: userStats,
            products: {
                total: productCount,
                categories: categoryBreakdown,
            },
            ai: {
                totalGenerations: totalGens,
                successfulGenerations: successGens,
                failedGenerations: totalGens - successGens,
                successRate: totalGens > 0 ? Math.round((successGens / totalGens) * 100) : 0,
                avgDurationMs: avgDuration,
                apiKeyStatus: health.checks.apiKey.ok ? 'valid' : 'missing',
            },
            topMaterials,
            recentGenerations,
            hourlyGenerations,
            timestamp: new Date().toISOString(),
        });
    } catch (error: any) {
        res.status(500).json({ error: getErrorMessage(error) });
    }
});

// ===== AI GENERATION ENDPOINTS (Server-side API key — clients don't need their own) =====

const cleanBase64 = (dataURI: string) =>
    dataURI.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");

const getMimeType = (dataURI: string) => {
    const match = dataURI.match(/^data:(image\/\w+);base64,/);
    return match ? match[1] : "image/jpeg";
};

const getLocalImageBase64 = (relativePath: string): { data: string; mimeType: string } | null => {
    try {
        if (!relativePath) return null;
        // Remove leading slash if present
        const cleanPath = relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
        
        // Try multiple locations for the image
        const possiblePaths = [
            path.join(process.cwd(), 'public', cleanPath),
            path.join(process.cwd(), cleanPath),
            path.resolve(cleanPath)
        ];

        for (const fullPath of possiblePaths) {
            if (fs.existsSync(fullPath)) {
                const data = fs.readFileSync(fullPath);
                const ext = path.extname(fullPath).toLowerCase().replace('.', '');
                const mimeType = ext === 'webp' ? 'image/webp' : ext === 'png' ? 'image/png' : 'image/jpeg';
                return { data: data.toString('base64'), mimeType };
            }
        }
        return null;
    } catch (e) {
        console.warn(`Could not load local image: ${relativePath}`, e);
        return null;
    }
};

const getErrorMessage = (error: any): string => {
    if (typeof error === "string") return error;
    if (error?.error?.message) return error.error.message;
    if (error?.response?.data?.error?.message) return error.response.data.error.message;
    if (error?.message) return error.message;
    return JSON.stringify(error);
};

const extractImage = (response: any): string => {
    if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
                return `data:image/png;base64,${part.inlineData.data}`;
            }
        }
    }
    throw new Error("No image generated in the response.");
};

// Get API key — server only, never exposed to client
const getServerApiKey = (): string => {
    // Priority: env var (Hostinger Node.js apps support this) > config file
    const envKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || "";
    if (envKey.trim()) {
        console.log("[API Key] Loaded from environment variable");
        return envKey.trim();
    }
    
    const configPath = findConfigPath();
    if (configPath) {
        try {
            const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
            if (config.GEMINI_API_KEY?.trim()) {
                console.log("[API Key] Loaded from config file:", configPath);
                return config.GEMINI_API_KEY.trim();
            }
        } catch (e) {
            console.error("[API Key] Error reading config file:", configPath, e);
        }
    }
    
    console.error("[API Key] No key found in env vars or config file. Checked paths:", JSON_CONFIG_PATHS);
    return "";
};

// POST /api/ai/generate-overlay — Server-side AI image generation
app.post("/api/ai/generate-overlay", async (req: Request, res: Response) => {
    try {
        const { originalImage, material, userInstruction, renderOptions, lang, userId } = req.body;
        
        // Check quota
        if (userId) {
            const quota = await checkAndIncrementQuota(userId);
            if (!quota.allowed) {
                return res.status(403).json({ 
                    error: "Quota exceeded", 
                    message: `You have used ${quota.used}/${quota.limit} generations. Please upgrade your tier.` 
                });
            }
        }

        // Get API key (server-side only)
        const apiKey = getServerApiKey();
        if (!apiKey) {
            return res.status(500).json({ 
                error: "API Key not configured on server. Please contact administrator." 
            });
        }

        const ai = new GoogleGenAI({ apiKey });
        const base64Data = cleanBase64(originalImage);
        const mimeType = getMimeType(originalImage);

        const isFurniture = material?.category === "Muebles" || material?.usage === "Furniture";
        
        const lightingHint =
            renderOptions?.lighting === "SUNSET"
                ? "warm golden hour sunset lighting"
                : renderOptions?.lighting === "NIGHT_LUXURY"
                    ? "dramatic night luxury lighting with warm interior glow"
                    : "natural ambient lighting";

        // Load product image as reference if available
        const productRef = getLocalImageBase64(material?.imageUrl);
        const hasProductImage = !!productRef;

        // Build prompt
        const materialIdentity = `"${material?.name || "selected material"}" — Category: ${material?.category || "general"}${material?.subcategory ? `, Sub: ${material.subcategory}` : ""}`;
        
        let finalPrompt: string;
        if (isFurniture) {
            finalPrompt = `You are a professional virtual stager.
Place the product shown in the "Product Reference" image into this room.
Product Name: ${materialIdentity}
Style: ${material?.promptModifier || "modern"}.
${userInstruction ? `User request: "${userInstruction}"` : ""}
Rules:
- Match room perspective, scale to surrounding objects
- Cast correct shadows from the room's light source (${lightingHint})
- Use exact textures/colors from the Product Reference image
- Do NOT alter existing furniture/objects unless user asks
- Output ONLY the final image`;
        } else {
            finalPrompt = `You are an architectural visualization specialist.
Apply the material shown in the "Product Reference" image to the correct surfaces in the room photo.
Material: ${materialIdentity}
${userInstruction ? `User request: "${userInstruction}"` : ""}
Rules:
- Apply material ONLY to matching surfaces (floors for flooring, walls for wall covering, ceilings for ceiling panels, etc.)
- Use the EXACT texture, pattern, and color from the Product Reference image
- Preserve all objects IN FRONT of the surface — do NOT paint over furniture, people, plants
- Match room perspective for texture mapping (grout lines, wood grain direction)
- Re-apply original shadows/highlights onto the new material
- Lighting: ${lightingHint}
- Output ONLY the final photorealistic image`;
        }

        const contents: any = {
            parts: [
                { inlineData: { data: base64Data, mimeType } }, // Part 1: Room Image
            ],
        };

        if (hasProductImage) {
            contents.parts.push({ text: "Product Reference Image:" });
            contents.parts.push({ inlineData: { data: productRef.data, mimeType: productRef.mimeType } });
        }

        contents.parts.push({ text: finalPrompt });

        // Generate with image-capable model (Nano Banana)
        const genStartTime = Date.now();
        let usedModel = "gemini-2.5-flash-image";
        let response;
        try {
            response = await ai.models.generateContent({
                model: "gemini-2.5-flash-image",
                contents,
                config: {
                    responseModalities: ["TEXT", "IMAGE"],
                },
            });
        } catch (primaryError: any) {
            console.warn("gemini-2.5-flash-image failed, trying fallback (gemini-3.1-flash-image-preview):", getErrorMessage(primaryError));
            usedModel = "gemini-3.1-flash-image-preview";
            response = await ai.models.generateContent({
                model: "gemini-3.1-flash-image-preview",
                contents,
                config: {
                    responseModalities: ["TEXT", "IMAGE"],
                },
            });
        }

        const resultImage = extractImage(response);
        const durationMs = Date.now() - genStartTime;
        
        // Log successful generation
        generationLog.push({
            timestamp: new Date().toISOString(),
            userId,
            materialId: material?.id || material?.refCode,
            materialName: material?.name,
            category: material?.category,
            success: true,
            durationMs,
            model: usedModel,
        });
        
        res.json({ success: true, image: resultImage });
        
        // Periodic success notification (every 50 gens to confirm health)
        if (generationLog.length % 50 === 0) {
            telegramAlerts.sendSuccessAlert(`Milestone reached: ${generationLog.length} generations total`, "System performance is stable.");
        }
        
    } catch (error: any) {
        const durationMs = Date.now() - (genStartTime || Date.now());
        
        // Log failed generation
        generationLog.push({
            timestamp: new Date().toISOString(),
            userId: req.body?.userId,
            materialId: req.body?.material?.id || req.body?.material?.refCode,
            materialName: req.body?.material?.name,
            category: req.body?.material?.category,
            success: false,
            durationMs,
            model: "error",
            error: getErrorMessage(error),
        });

        console.error("AI Generation failed:", error);
        telegramAlerts.sendErrorAlert(error, `AI Generation failed for user ${req.body?.userId || 'anonymous'} while rendering ${req.body?.material?.name || 'unknown material'}`);
        
        res.status(500).json({ error: getErrorMessage(error) });
    }
});

// POST /api/ai/analyze-room — Server-side room analysis
app.post("/api/ai/analyze-room", async (req: Request, res: Response) => {
    try {
        const { image, userId, lang } = req.body;
        
        if (userId) {
            const quota = await checkAndIncrementQuota(userId);
            if (!quota.allowed) {
                return res.status(403).json({ error: "Quota exceeded" });
            }
        }

        const apiKey = getServerApiKey();
        if (!apiKey) {
            return res.status(500).json({ error: "API Key not configured on server" });
        }

        const ai = new GoogleGenAI({ apiKey });
        const base64Data = cleanBase64(image);
        const mimeType = getMimeType(image);

        let response;
        try {
            response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: {
                    parts: [
                        { inlineData: { data: base64Data, mimeType } },
                        {
                            text: "Analyze this interior/exterior space as a Senior Architect. 1) Identify the Design Style. 2) Analyze lighting. 3) Suggest ideal materials. Keep it brief and professional (max 100 words).",
                        },
                    ],
                },
            });
        } catch (primaryError: any) {
            console.warn("gemini-2.5-flash failed for analysis:", getErrorMessage(primaryError));
            // Re-throw — gemini-2.5-flash is the most reliable text model
            throw primaryError;
        }

        res.json({ success: true, analysis: response.text || "Could not analyze the room." });
        
    } catch (error: any) {
        console.error("Room analysis error:", error);
        res.status(500).json({ error: getErrorMessage(error) });
    }
});

// ===== MATERIALS ENDPOINTS (existing) =====

// Get all materials
app.get('/api/materials', async (req: Request, res: Response) => {
    try {
        const materials = await getMaterials();
        res.json(materials);
    } catch (error: any) {
        console.error('Get materials error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create material
app.post('/api/materials', async (req: Request, res: Response) => {
    try {
        const {
            ref_code, name, category, subcategory, price, price_contractor, currency, unit,
            items_per_box, width_cm, length_cm, thickness_m,
            description, image_url, usage, prompt_modifier
        } = req.body;

        try {
            const result = await query(
                `INSERT INTO materials (
            ref_code, name, category, subcategory, price, price_contractor, currency, unit,
            items_per_box, width_cm, length_cm, thickness_m,
            description, image_url, usage, prompt_modifier
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
          RETURNING *`,
                [ref_code, name, category, subcategory, price, price_contractor || price, currency || 'USD', unit,
                    items_per_box || 1, width_cm, length_cm, thickness_m,
                    description, image_url, usage, prompt_modifier]
            );
            return res.status(201).json(result.rows[0]);
        } catch (dbError) {
            console.warn('DB Insert failed, updating JSON fallback...');
            const materials = await getMaterials();
            const newItem = { id: `mat-${Date.now()}`, ...req.body, created_at: new Date().toISOString() };
            materials.unshift(newItem);
            saveToJSON(JSON_DB_PATH, materials);
            return res.status(201).json(newItem);
        }
    } catch (error: any) {
        console.error('Create material error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update material
app.put('/api/materials/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const {
            ref_code, name, category, subcategory, price, currency, unit,
            items_per_box, width_cm, length_cm, thickness_m,
            description, image_url, usage, prompt_modifier
        } = req.body;

        const result = await query(
            `UPDATE materials SET
        ref_code = $2, name = $3, category = $4, subcategory = $5,
        price = $6, currency = $7, unit = $8, items_per_box = $9,
        width_cm = $10, length_cm = $11, thickness_m = $12,
        description = $13, image_url = $14, usage = $15, prompt_modifier = $16,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *`,
            [id, ref_code, name, category, subcategory, price, currency, unit,
                items_per_box, width_cm, length_cm, thickness_m,
                description, image_url, usage, prompt_modifier]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Material not found' });
        }
        res.json(result.rows[0]);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ===== MARKETPLACE & INSTALLERS =====

app.post('/api/marketplace/installers', async (req: Request, res: Response) => {
    try {
        const { lat, lon, limit = 3 } = req.body;
        if (!lat || !lon) return res.status(400).json({ error: 'Coordinates required' });

        // Get approved installers from DB or JSON
        let installers = [];
        try {
            const result = await query('SELECT * FROM contractors WHERE is_approved = true');
            installers = result.rows;
        } catch (e) {
            // JSON Fallback
            installers = [
                { id: '1', name: 'Master Floors Medellín', lat: 6.2442, lon: -75.5812, region: 'Antioquia', approved: true },
                { id: '2', name: 'Luxury Walls Bogota', lat: 4.7110, lon: -74.0721, region: 'Cundinamarca', approved: true },
                { id: '3', name: 'Pro Installers Cali', lat: 3.4516, lon: -76.5320, region: 'Valle', approved: true },
            ];
        }

        // Calculate distances
        const installersWithDistance = installers.map((inst: any) => ({
            ...inst,
            distance_km: calculateDistance(lat, lon, inst.lat || 0, inst.lon || 0)
        }));

        // Sort by distance and return top N
        const sorted = installersWithDistance
            .sort((a, b) => a.distance_km - b.distance_km)
            .slice(0, limit);

        res.json(sorted);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});


// Delete material
app.delete('/api/materials/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        try {
            // Try deleting by numeric ID or by RefCode (SKU)
            const result = await query('DELETE FROM materials WHERE id = $1 OR ref_code = $2 RETURNING id', [id, id]);
            
            // Sync to JSON fallback if we have a DB connection
            const all = await query('SELECT * FROM materials ORDER BY category, name');
            saveToJSON(JSON_DB_PATH, all.rows);
            
            if (result.rows.length === 0) {
                throw new Error('Not found in DB');
            }
            res.json({ success: true, id: result.rows[0].id });
        } catch (dbError: any) {
            console.warn('DB delete failed or not found, checking JSON fallback:', dbError.message);
            const materials = await getMaterials();
            const initialLength = materials.length;
            
            // Filter by ID or RefCode (SKU)
            const filtered = materials.filter((m: any) => 
                String(m.id) !== String(id) && 
                String(m.refCode || m.ref_code || '') !== String(id)
            );
            
            if (filtered.length === initialLength) {
                return res.status(404).json({ error: 'Material not found in fallback' });
            }
            
            saveToJSON(JSON_DB_PATH, filtered);
            res.json({ success: true, id, note: 'Deleted from JSON fallback' });
        }
    } catch (error: any) {
        console.error('Delete material error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Bulk import materials
app.post('/api/materials/bulk', async (req: Request, res: Response) => {
    try {
        const { materials } = req.body;

        if (!Array.isArray(materials) || materials.length === 0) {
            return res.status(400).json({ error: 'Invalid materials array' });
        }

        const values = materials.map(m => [
            m.ref_code, m.name, m.category, m.subcategory, m.price, m.currency || 'USD',
            m.unit, m.items_per_box || 1, m.width_cm, m.length_cm, m.thickness_m,
            m.description, m.image_url, m.usage, m.prompt_modifier
        ]);

        let imported = 0;
        for (const vals of values) {
            await query(
                `INSERT INTO materials (
          ref_code, name, category, subcategory, price, currency, unit,
          items_per_box, width_cm, length_cm, thickness_m,
          description, image_url, usage, prompt_modifier
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
                vals
            );
            imported++;
        }

        res.json({ success: true, imported });
    } catch (error: any) {
        console.error('Bulk import error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete all materials (factory reset)
app.delete('/api/materials', async (req: Request, res: Response) => {
    try {
        await query('DELETE FROM materials');
        res.json({ success: true, message: 'All materials deleted' });
    } catch (error: any) {
        console.error('Delete all materials error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== PURCHASE REQUESTS API (new) =====

// Create purchase request (from Cart)
app.post('/api/purchase-requests', async (req: Request, res: Response) => {
    try {
        const {
            user_id,
            customer_name,
            customer_email,
            customer_phone,
            customer_address,
            cart_items,
            total_estimate,
            currency,
            project_notes,
            room_image_url
        } = req.body;

        // Validation
        if (!customer_name || !customer_email || !customer_phone || !customer_address || !cart_items || !total_estimate) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (!Array.isArray(cart_items) || cart_items.length === 0) {
            return res.status(400).json({ error: 'Cart must contain at least one item' });
        }

        // Insert purchase request
        const result = await query(
            `INSERT INTO purchase_requests (
        user_id, customer_name, customer_email, customer_phone, customer_address,
        cart_items, total_estimate, currency, project_notes, room_image_url, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
            [
                user_id || null,
                customer_name,
                customer_email,
                customer_phone,
                customer_address,
                JSON.stringify(cart_items),
                total_estimate,
                currency || 'USD',
                project_notes || null,
                room_image_url || null,
                'pending'
            ]
        );

        const purchaseRequest = result.rows[0];

        // Send email notifications
        try {
            const notifications = await sendPurchaseNotifications({
                ...purchaseRequest,
                cart_items: JSON.parse(purchaseRequest.cart_items)
            });

            // Also send Telegram alert
            try {
                await telegramAlerts.sendPurchaseAlert({
                    customerName: `${first_name} ${last_name}`,
                    company: company_name,
                    materialName: material_name || 'Multiple items',
                    quantity: quantity || cart_items?.reduce((sum: number, item: any) => sum + (item.quantity || 1), 0) || 1,
                    totalPrice: total_price,
                    customerEmail: customer_email,
                    phone: phone
                });
            } catch (tgErr) {
                console.warn('[Telegram] Purchase alert failed:', tgErr);
            }

            // Log email delivery
            if (notifications.customer.success) {
                await query(
                    `INSERT INTO email_logs (purchase_request_id, recipient_email, email_type, status)
           VALUES ($1, $2, $3, $4)`,
                    [purchaseRequest.id, customer_email, 'customer_confirmation', 'sent']
                );
            }

            if (notifications.admin.success) {
                await query(
                    `INSERT INTO email_logs (purchase_request_id, recipient_email, email_type, status)
           VALUES ($1, $2, $3, $4)`,
                    [purchaseRequest.id, process.env.ADMIN_EMAIL || 'admin@constructviz.com', 'admin_alert', 'sent']
                );
            }

            res.status(201).json({
                success: true,
                request: purchaseRequest,
                notifications: {
                    customerEmailSent: notifications.customer.success,
                    adminEmailSent: notifications.admin.success
                }
            });
        } catch (emailError: any) {
            console.error('Email notification failed:', emailError);
            // Still return success since DB insert worked
            res.status(201).json({
                success: true,
                request: purchaseRequest,
                notifications: {
                    customerEmailSent: false,
                    adminEmailSent: false,
                    error: 'Email notifications failed'
                }
            });
        }
    } catch (error: any) {
        console.error('Create purchase request error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Send quote email (from estimation panel)
app.post('/api/send-quote-email', async (req: Request, res: Response) => {
    try {
        const {
            materialName,
            refCode,
            quantity,
            unitLabel,
            width,
            height,
            estimatedCost,
            userEmail,
            userName
        } = req.body;

        // Validation
        if (!userEmail || !materialName || !estimatedCost) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // 1. Create a purchase request for this single quote (so it shows in admin)
        const cartItems = [{
            materialId: refCode,
            materialName: materialName,
            quantity: quantity,
            unitCost: estimatedCost / (quantity || 1)
        }];

        const result = await query(
            `INSERT INTO purchase_requests (
                customer_name, customer_email, customer_phone, customer_address,
                cart_items, total_estimate, currency, project_notes, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *`,
            [
                userName || 'Guest User',
                userEmail,
                'N/A',
                'Requested via Estimation Panel',
                JSON.stringify(cartItems),
                estimatedCost,
                'USD',
                `Dimensions: ${width}m x ${height}m. Single quote request.`,
                'pending'
            ]
        );

        const purchaseRequest = result.rows[0];

        // 2. Send emails
        try {
            const notifications = await sendPurchaseNotifications({
                ...purchaseRequest,
                cart_items: cartItems as any
            });

            res.status(201).json({
                success: true,
                requestId: purchaseRequest.id,
                emailSent: notifications.customer.success && notifications.admin.success
            });
        } catch (emailError: any) {
            console.error('Email notification failed for quote:', emailError);
            res.status(201).json({
                success: true,
                requestId: purchaseRequest.id,
                emailSent: false,
                warning: 'Saved to database but email failed'
            });
        }
    } catch (error: any) {
        console.error('Send quote email error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all purchase requests (admin)
app.get('/api/purchase-requests', async (req: Request, res: Response) => {
    try {
        const { status } = req.query;

        let query = 'SELECT * FROM purchase_requests';
        const params: any[] = [];

        if (status) {
            query += ' WHERE status = $1';
            params.push(status);
        }

        query += ' ORDER BY created_at DESC';

        const result = await query(query, params);

        // Parse cart_items JSON
        const requests = result.rows.map(row => ({
            ...row,
            cart_items: JSON.parse(row.cart_items)
        }));

        res.json(requests);
    } catch (error: any) {
        console.error('Get purchase requests error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single purchase request
app.get('/api/purchase-requests/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const result = await query('SELECT * FROM purchase_requests WHERE id = $1', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Purchase request not found' });
        }

        const request = {
            ...result.rows[0],
            cart_items: JSON.parse(result.rows[0].cart_items)
        };

        res.json(request);
    } catch (error: any) {
        console.error('Get purchase request error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update purchase request status
app.patch('/api/purchase-requests/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { status, contacted_by } = req.body;

        const updateFields: string[] = [];
        const values: any[] = [];
        let paramIndex = 2;

        if (status) {
            updateFields.push(`status = $${paramIndex}`);
            values.push(status);
            paramIndex++;

            if (status === 'contacted' || status === 'quote_sent') {
                updateFields.push(`contacted_at = CURRENT_TIMESTAMP`);
                if (contacted_by) {
                    updateFields.push(`contacted_by = $${paramIndex}`);
                    values.push(contacted_by);
                    paramIndex++;
                }
            }
        }

        updateFields.push('updated_at = CURRENT_TIMESTAMP');

        const result = await query(
            `UPDATE purchase_requests 
       SET ${updateFields.join(', ')}
       WHERE id = $1
       RETURNING *`,
            [id, ...values]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Purchase request not found' });
        }

        res.json(result.rows[0]);
    } catch (error: any) {
        console.error('Update purchase request error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== USER AUTHENTICATION API (new) =====

// Simple user signup
app.post('/api/auth/signup', async (req: Request, res: Response) => {
    try {
        const { name, email, phone, address, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email, and password required' });
        }

        try {
            // Check if email already exists
            const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
            if (existing.rows.length > 0) {
                return res.status(400).json({ error: 'Email already registered' });
            }

            // Hash password before saving
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);

            const result = await query(
                `INSERT INTO users (name, email, phone, address, password_hash, role, tier, generations_used)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, name, email, phone, address, role, tier, generations_used, created_at`,
                [name, email, phone || null, address || null, hashedPassword, 'customer', 'Free', 0]
            );

            res.status(201).json({ user: result.rows[0] });
        } catch (dbError) {
            console.warn('Signup DB unavailable, using JSON fallback...');
            
            // Check local JSON
            const users = await getUsers();
            if (users.find((u: any) => u.email === email)) {
                return res.status(400).json({ error: 'Email already registered in fallback' });
            }

            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);

            const newUser = {
                id: Date.now(),
                name,
                email,
                phone: phone || null,
                address: address || null,
                password_hash: hashedPassword,
                role: 'customer',
                tier: 'Free',
                generations_used: 0,
                created_at: new Date().toISOString()
            };

            users.push(newUser);
            saveToJSON(JSON_USERS_PATH, users);

            // Don't return password hash
            const { password_hash, ...userResponse } = newUser;
            res.status(201).json({ user: userResponse });
        }
    } catch (error: any) {
        console.error('Signup error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Simple user login
app.post('/api/auth/login', async (req: Request, res: Response) => {
    const email: string = req.body?.email || '';
    const password: string = req.body?.password || '';
    try {
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        // Hardcoded admin fallback
        if (email === 'admin@gmail.com' && password === 'admin@@@1') {
            return res.json({ 
                user: { 
                    id: 999, 
                    name: 'Super Admin', 
                    email: 'admin@gmail.com', 
                    role: 'admin',
                    tier: 'Enterprise',
                    generations_used: 0
                } 
            });
        }

        try {
            const result = await query(
                'SELECT id, name, email, phone, address, role, tier, generations_used, password_hash FROM users WHERE email = $1',
                [email]
            );

            if (result.rows.length > 0) {
                const user = result.rows[0];
                const isMatch = await bcrypt.compare(password, user.password_hash);
                if (!isMatch) {
                    return res.status(401).json({ error: 'Invalid credentials' });
                }
                const { password_hash, ...userResponse } = user;
                return res.json({ user: userResponse });
            }
            
            // If not in DB, check JSON fallback anyway (might be newly signed up in fallback)
            throw new Error('Not found in DB');
            
        } catch (dbError) {
            console.warn('Login DB unavailable or user not found, checking JSON fallback...');
            const users = await getUsers();
            const user = users.find((u: any) => u.email === email);

            if (!user) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            const isMatch = await bcrypt.compare(password, user.password_hash);
            if (!isMatch) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            const { password_hash, ...userResponse } = user;
            return res.json({ user: userResponse });
        }
    } catch (error: any) {
        console.error('Login error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== MATERIAL MANAGEMENT API (new) =====

// Get all materials
app.get('/api/materials', async (req: Request, res: Response) => {
    try {
        const result = await query('SELECT * FROM materials ORDER BY category, name');
        if (result.rows.length === 0) {
            // Fallback to JSON if DB is empty
            if (fs.existsSync(JSON_DB_PATH)) {
                const data = fs.readFileSync(JSON_DB_PATH, 'utf8');
                return res.json(JSON.parse(data));
            }
        }
        res.json(result.rows);
    } catch (error: any) {
        // Fallback to JSON if DB is down
        if (fs.existsSync(JSON_DB_PATH)) {
            const data = fs.readFileSync(JSON_DB_PATH, 'utf8');
            return res.json(JSON.parse(data));
        }
        res.status(500).json({ error: error.message });
    }
});

// Create/Update material
app.post('/api/materials', async (req: Request, res: Response) => {
    try {
        const m = req.body;
        const result = await query(
            `INSERT INTO materials (
                ref_code, name, category, subcategory, price, price_contractor, currency, 
                unit, items_per_box, width_cm, length_cm, thickness_m, 
                description, image_url, usage, prompt_modifier
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            ON CONFLICT (ref_code) DO UPDATE SET
                name = EXCLUDED.name,
                category = EXCLUDED.category,
                subcategory = EXCLUDED.subcategory,
                price = EXCLUDED.price,
                price_contractor = EXCLUDED.price_contractor,
                currency = EXCLUDED.currency,
                unit = EXCLUDED.unit,
                items_per_box = EXCLUDED.items_per_box,
                width_cm = EXCLUDED.width_cm,
                length_cm = EXCLUDED.length_cm,
                thickness_m = EXCLUDED.thickness_m,
                description = EXCLUDED.description,
                image_url = EXCLUDED.image_url,
                usage = EXCLUDED.usage,
                prompt_modifier = EXCLUDED.prompt_modifier,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *`,
            [
                m.ref_code, m.name, m.category, m.subcategory, m.price, m.price_contractor || m.price, m.currency,
                m.unitLabel, m.items_per_box, m.width_cm, m.length_cm, m.thickness_m,
                m.description, m.image_url, m.usage, m.prompt_modifier
            ]
        );

        // Sync to JSON fallback
        const all = await query('SELECT * FROM materials ORDER BY category, name');
        fs.writeFileSync(JSON_DB_PATH, JSON.stringify(all.rows, null, 2));

        res.json(result.rows[0]);
    } catch (error: any) {
        console.warn('DB update failed, updating JSON directly:', error.message);
        
        // Direct JSON fallback update
        try {
            let data: any[] = [];
            if (fs.existsSync(JSON_DB_PATH)) {
                data = JSON.parse(fs.readFileSync(JSON_DB_PATH, 'utf8'));
            }
            
            const m = req.body;
            const index = data.findIndex(item => (item.refCode || item.ref_code) === m.ref_code);
            
            const newMaterial = {
                id: m.ref_code,
                refCode: m.ref_code,
                name: m.name,
                category: m.category,
                subcategory: m.subcategory,
                usage: m.usage,
                description: m.description,
                imageUrl: m.image_url,
                promptModifier: m.prompt_modifier,
                pricing: {
                    pricePerUnit: m.price,
                    priceContractor: m.price_contractor,
                    currency: m.currency,
                    unitLabel: m.unitLabel || m.unit,
                    itemsPerBox: m.items_per_box
                },
                dimensions: {
                    width: m.width_cm,
                    length: m.length_cm,
                    thickness: m.thickness_m
                }
            };

            if (index !== -1) {
                data[index] = { ...data[index], ...newMaterial };
            } else {
                data.push(newMaterial);
            }
            
            fs.writeFileSync(JSON_DB_PATH, JSON.stringify(data, null, 2));
            return res.json(newMaterial);
        } catch (jsonError: any) {
            return res.status(500).json({ error: 'Failed to update both DB and JSON: ' + jsonError.message });
        }
    }
});
 
 // Update material by ID
 app.put('/api/materials/:id', async (req: Request, res: Response) => {
     try {
         const { id } = req.params;
         const m = req.body;
         const result = await query(
             `UPDATE materials SET
                 name = $1, category = $2, subcategory = $3, price = $4, price_contractor = $5,
                 currency = $6, unit = $7, items_per_box = $8, width_cm = $9, length_cm = $10,
                 thickness_m = $11, description = $12, image_url = $13, usage = $14,
                 prompt_modifier = $15, updated_at = CURRENT_TIMESTAMP
             WHERE id = $16 RETURNING *`,
             [
                 m.name, m.category, m.subcategory, m.price, m.price_contractor,
                 m.currency, m.unitLabel || m.unit, m.items_per_box, m.width_cm, m.length_cm,
                 m.thickness_m, m.description, m.image_url, m.usage, m.prompt_modifier, id
             ]
         );
 
         // Sync to JSON
         const all = await query('SELECT * FROM materials ORDER BY category, name');
         fs.writeFileSync(JSON_DB_PATH, JSON.stringify(all.rows, null, 2));
 
         res.json(result.rows[0]);
     } catch (error: any) {
         console.warn('DB update failed, updating JSON directly:', error.message);
         try {
             let data: any[] = [];
             if (fs.existsSync(JSON_DB_PATH)) {
                 data = JSON.parse(fs.readFileSync(JSON_DB_PATH, 'utf8'));
             }
             const { id } = req.params;
             const m = req.body;
             const index = data.findIndex(item => String(item.id) === String(id) || String(item.refCode) === String(id));
             
             if (index !== -1) {
                 data[index] = {
                     ...data[index],
                     name: m.name,
                     category: m.category,
                     subcategory: m.subcategory,
                     usage: m.usage,
                     description: m.description,
                     imageUrl: m.image_url,
                     promptModifier: m.prompt_modifier,
                     pricing: {
                         pricePerUnit: m.price,
                         priceContractor: m.price_contractor,
                         currency: m.currency,
                         unitLabel: m.unitLabel || m.unit,
                         itemsPerBox: m.items_per_box
                     },
                     dimensions: {
                         width: m.width_cm,
                         length: m.length_cm,
                         thickness: m.thickness_m
                     }
                 };
                 fs.writeFileSync(JSON_DB_PATH, JSON.stringify(data, null, 2));
                 return res.json(data[index]);
             }
             res.status(404).json({ error: 'Material not found in JSON' });
         } catch (jsonError: any) {
             res.status(500).json({ error: jsonError.message });
         }
     }
 });


app.patch('/api/admin/users/:id/tier', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { tier } = req.body;

        if (!['Free', 'Pro', 'Enterprise'].includes(tier)) {
            return res.status(400).json({ error: 'Invalid tier' });
        }

        const result = await query(
            'UPDATE users SET tier = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, name, email, tier',
            [tier, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(result.rows[0]);
    } catch (error: any) {
        console.error('Update tier error:', error);
        
        // Fallback to JSON
        try {
            const users = await getUsers();
            const index = users.findIndex((u: any) => String(u.id) === String(req.params.id));
            if (index !== -1) {
                users[index].tier = req.body.tier;
                saveToJSON(JSON_USERS_PATH, users);
                return res.json(users[index]);
            }
            res.status(404).json({ error: 'User not found in JSON' });
        } catch (jsonError) {
            res.status(500).json({ error: error.message });
        }
    }
});

// Create Admin User (Admin only)
app.post('/api/admin/users/create-admin', async (req: Request, res: Response) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email and password required' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        try {
            const result = await query(
                `INSERT INTO users (name, email, password_hash, role, tier)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING id, name, email, role, tier, created_at`,
                [name, email, hashedPassword, 'admin', 'Enterprise']
            );
            res.status(201).json(result.rows[0]);
        } catch (dbError) {
            console.warn('DB down, creating Admin in JSON...');
            const users = await getUsers();
            if (users.find((u: any) => u.email === email)) {
                return res.status(400).json({ error: 'Email already exists' });
            }

            const newAdmin = {
                id: Date.now(),
                name,
                email,
                password_hash: hashedPassword,
                role: 'admin',
                tier: 'Enterprise',
                generations_used: 0,
                created_at: new Date().toISOString()
            };
            users.push(newAdmin);
            saveToJSON(JSON_USERS_PATH, users);
            
            const { password_hash, ...response } = newAdmin;
            res.status(201).json(response);
        }
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Get all users (Admin only)
app.get('/api/admin/users', async (req: Request, res: Response) => {
    try {
        const result = await query('SELECT id, name, email, role, tier, generations_used, created_at FROM users ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (error: any) {
        console.warn('Database unavailable, reading from local users fallback for admin...');
        const users = await getUsers();
        res.json(users);
    }
});

// ===== AI GENERATION PROXY (Quota Enforced) =====

async function checkAndIncrementQuota(userId: number): Promise<{ allowed: boolean; limit?: number; used?: number; error?: string }> {
    try {
        // Special case for Super Admin
        if (userId === 999) return { allowed: true };

        const result = await query('SELECT tier, generations_used FROM users WHERE id = $1', [userId]);
        if (result.rows.length === 0) return { allowed: false, error: 'User not found' };

        const { tier, generations_used } = result.rows[0];
        const tierKey = (tier || 'FREE').toUpperCase();
        const tierConfig = (TIERS as any)[tierKey] || TIERS.FREE;

        if (generations_used >= tierConfig.limit) {
            return { allowed: false, limit: tierConfig.limit, used: generations_used };
        }

        await query('UPDATE users SET generations_used = generations_used + 1 WHERE id = $1', [userId]);
        return { allowed: true, used: generations_used + 1, limit: tierConfig.limit };
    } catch (e: any) {
        console.warn('Quota check fallback to JSON:', e.message);
        
        // JSON fallback quota check
        try {
            const users = await getUsers();
            const user = users.find((u: any) => String(u.id) === String(userId));
            if (!user) return { allowed: true }; // Allow if user not found to avoid blocking

            const tier = user.tier || 'Free';
            const tierConfig = TIERS[tier.toUpperCase() as keyof typeof TIERS] || TIERS.FREE;
            const used = user.generations_used || 0;

            if (used >= tierConfig.limit) {
                return { allowed: false, limit: tierConfig.limit, used };
            }

            user.generations_used = used + 1;
            try {
                saveToJSON(JSON_USERS_PATH, users);
            } catch (saveErr) {
                console.error('Failed to save to users.json:', saveErr);
            }
            return { allowed: true, used: used + 1, limit: tierConfig.limit };
        } catch (jsonErr) {
            return { allowed: true };
        }
    }
}

app.get('/api/debug', async (req: Request, res: Response) => {
    const debugInfo: any = {
        status: 'online',
        timestamp: new Date().toISOString(),
        env: {
            node_env: process.env.NODE_ENV,
            has_db_url: !!process.env.DATABASE_URL,
            port: PORT
        }
    };

    try {
        await query('SELECT 1');
        debugInfo.database = 'connected';
    } catch (e: any) {
        debugInfo.database = `error: ${e.message}`;
    }

    try {
        const users = await getUsers();
        debugInfo.json_users_count = users.length;
    } catch (e: any) {
        debugInfo.json_users = `error: ${e.message}`;
    }

    res.json(debugInfo);
});

app.post('/api/log-error', (req: Request, res: Response) => {
    const { error, context, userId } = req.body;
    const entry = {
        timestamp: new Date().toISOString(),
        error,
        context,
        userId
    };
    errorLog.unshift(entry);
    if (errorLog.length > 50) errorLog.pop();
    console.error('Frontend Error:', entry);
    res.json({ status: 'logged' });
});

app.get('/api/debug/errors', (req: Request, res: Response) => {
    res.json(errorLog);
});

app.post('/api/ai/generate', async (req: Request, res: Response) => {
    try {
        const { userId, type, data } = req.body;
        if (!userId) return res.status(401).json({ error: 'Authentication required' });

        const quota = await checkAndIncrementQuota(userId);
        if (!quota.allowed) {
            return res.status(403).json({ 
                error: 'Quota exceeded', 
                message: `You have used ${quota.used}/${quota.limit} generations. Please upgrade your tier.` 
            });
        }

        // Logic for calling Gemini
        const config = await getConfig();
        const apiKey = config.GEMINI_API_KEY;
        
        if (!apiKey) {
            return res.status(400).json({ error: 'API Key not configured. Please set it in Admin Dashboard.' });
        }

        res.json({ success: true, quota, apiKey });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Admin Config Endpoints
app.get('/api/admin/config', async (req: Request, res: Response) => {
    const config = await getConfig();
    res.json({ hasKey: !!config.GEMINI_API_KEY });
});

// Debug endpoint — helps diagnose path issues on Hostinger (safe: no key exposed)
app.get('/api/debug/config-path', async (req: Request, res: Response) => {
    const searches = JSON_CONFIG_PATHS.map(p => ({
        path: p,
        exists: fs.existsSync(p),
        cwd: process.cwd(),
        dirname: SERVER_DIR,
    }));
    const found = searches.find(s => s.exists);
    const config = await getConfig();
    res.json({
        cwd: process.cwd(),
        dirname: SERVER_DIR,
        pathsSearched: searches,
        configFound: !!found,
        configPath: found?.path || null,
        keyPresent: !!config.GEMINI_API_KEY,
        keyLength: config.GEMINI_API_KEY?.length || 0,
        envKeyPresent: !!(process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY),
    });
});

app.post('/api/admin/config', async (req: Request, res: Response) => {
    try {
        const { apiKey } = req.body;
        if (!apiKey) return res.status(400).json({ error: 'API Key required' });
        
        const config = await getConfig();
        config.GEMINI_API_KEY = apiKey;
        saveToJSON(JSON_CONFIG_PATH, config);
        
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// ===== IMAGE PROXY (solves Google Drive 403 in browser) =====
// The browser can't directly fetch lh3.googleusercontent.com with CORS/auth.
// This endpoint fetches the image server-side and streams it back.
app.get('/api/proxy-image', async (req: Request, res: Response) => {
    try {
        const { url } = req.query as { url: string };
        if (!url) return res.status(400).json({ error: 'Missing url param' });

        const imageRes = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://drive.google.com'
            }
        });

        if (!imageRes.ok) {
            return res.status(imageRes.status).json({ error: 'Image fetch failed', status: imageRes.status });
        }

        const contentType = imageRes.headers.get('content-type') || 'image/jpeg';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400'); // cache 24h

        // Stream the image bytes directly
        const buffer = await imageRes.arrayBuffer();
        res.send(Buffer.from(buffer));
    } catch (e: any) {
        console.error('Image proxy error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// Serve static files from the frontend build
const distPath = fs.existsSync(path.join(path.resolve(), 'dist'))
    ? path.join(path.resolve(), 'dist')
    : path.resolve();

console.log(`📂 Serving static files from: ${distPath}`);

app.use(express.static(distPath));

// SPA fallback: handle all non-API routes
app.use((req: Request, res: Response, next) => {
    // If it's an API route that wasn't matched, continue to error handler
    if (req.path.startsWith('/api')) {
        return next();
    }
    
    // If the file exists as a static asset, let express.static handle it
    const filePath = path.join(distPath, req.path);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        return next();
    }

    // Otherwise, serve index.html for SPA routing
    res.sendFile(path.join(distPath, 'index.html'));
});

// Start server
app.listen(PORT, async () => {
    console.log(`🚀 ConstructViz AI Server running on port ${PORT}`);
    console.log(`📊 Serving from: ${distPath}`);
    
    // Initialize Telegram from config file
    try {
        const { initTelegramFromConfig } = await import('./telegramAlerts');
        await initTelegramFromConfig();
    } catch (e) {
        console.warn('[Telegram] Config init failed:', e);
    }
    
    // Send startup notification via email (primary)
    try {
        await productionAlerts.sendStartupAlert(BUILD_COMMIT, PORT);
    } catch (e) {
        console.warn('[Alerts] Startup email failed:', e);
    }
    
    // Send startup notification via Telegram (secondary)
    try {
        await telegramAlerts.sendStartupAlert(BUILD_COMMIT, PORT);
    } catch (e) {
        console.warn('[Telegram] Startup alert failed:', e);
    }
    
    // Schedule daily health report (every 24 hours)
    setInterval(async () => {
        try {
            const health = await monitor.getHealth();
            await productionAlerts.sendHealthAlert(health);
            await monitor.sendHealthAlert(); // Telegram
        } catch (e) {
            console.warn('[Alerts] Daily report failed:', e);
        }
    }, 24 * 60 * 60 * 1000); // 24 hours
    
    // Also send initial health report after 30 seconds
    setTimeout(async () => {
        try {
            const health = await monitor.getHealth();
            await productionAlerts.sendHealthAlert(health, true);
            await monitor.sendHealthAlert(); // Telegram
        } catch (e) {
            console.warn('[Alerts] Initial report failed:', e);
        }
    }, 30000);
});

} catch (startupError) {
    logCrash(startupError);
    process.exit(1);
}
