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
import { loadConfig, generateOverlay, analyzeRoom, checkProviderHealth, type AIConfig, type AIProvider } from "./services/aiProviders.js";
import Stripe from 'stripe';
import { sendPurchaseNotifications } from './emailService';
import { BUILD_COMMIT, BUILD_TIME } from './buildInfo';
import { telegramAlerts } from './telegramAlerts';
import mysql from 'mysql2/promise';

// SERVER_DIR: use process.cwd() for CJS bundled output, or compute from import.meta.url for ESM dev
const SERVER_DIR = path.resolve();

// Manually load .env file if it exists (highly robust for Hostinger and local environments)
try {
    const searchPaths = [
        path.join(process.cwd(), '.env'),
        path.resolve(process.cwd(), '..', '.env'),
        path.resolve(process.cwd(), '..', '..', '.env'),
        path.resolve(process.cwd(), '..', '..', '..', '.env'),
    ];
    let loaded = false;
    for (const envPath of searchPaths) {
        if (fs.existsSync(envPath)) {
            const envConfig = fs.readFileSync(envPath, 'utf8');
            envConfig.split(/\r?\n/).forEach(line => {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#')) {
                    const firstEquals = trimmed.indexOf('=');
                    if (firstEquals !== -1) {
                        const key = trimmed.substring(0, firstEquals).trim();
                        let value = trimmed.substring(firstEquals + 1).trim();
                        // Remove enclosing quotes if any
                        value = value.replace(/^['"]|['"]$/g, '');
                        if (key && !process.env[key]) {
                            process.env[key] = value;
                        }
                    }
                }
            });
            console.log('[Server Boot] Loaded environment variables from .env file at: ' + envPath);
            loaded = true;
            break;
        }
    }
    if (!loaded) {
        console.warn('[Server Boot] No .env file found in parent directory search paths');
    }
} catch (e) {
    console.error('[Server Boot] Error reading .env file manually:', e.message);
}

// [SystemMonitor class moved to after config definitions]


// CRASH LOGGER: Captures startup errors on Hostinger
function logCrash(error: any) {
    const msg = `${new Date().toISOString()}\n${error.stack || error}\n`;
    try {
        fs.appendFileSync(path.join(process.cwd(), 'crash.log'), msg);
    } catch (e) {}
    console.error('CRITICAL STARTUP ERROR:', error);

    // Send Telegram alert
    try {
        telegramAlerts.sendMessage({
            text: `<b>🚨 CRITICAL STARTUP ERROR</b>\n\n` +
                  `<b>Error:</b> <code>${(error.message || String(error)).substring(0, 200)}</code>\n` +
                  `<b>Stack:</b> <pre>${(error.stack || 'No stack').substring(0, 500)}</pre>`,
            parse_mode: 'HTML'
        });
    } catch (tgErr) {
        console.error('Failed to send crash to Telegram:', tgErr);
    }
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

const mysqlPool = (!isPostgres && process.env.DB_HOST) 
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

interface TierInfo {
    name: string;
    limit: number;
    price: number;
    stripePriceId: string;
}

interface TiersConfig {
    FREE: TierInfo;
    STANDARD: TierInfo;
    PREMIUM: TierInfo;
    LUXURY: TierInfo;
}

const DEFAULT_TIERS: TiersConfig = {
    FREE: { name: 'FREE', limit: 10, price: 0, stripePriceId: '' },
    STANDARD: { name: 'STANDARD', limit: 500, price: 4.99, stripePriceId: 'price_standard_placeholder' },
    PREMIUM: { name: 'PREMIUM', limit: 1000, price: 24.99, stripePriceId: 'price_premium_placeholder' },
    LUXURY: { name: 'LUXURY', limit: 999999, price: 49.99, stripePriceId: 'price_luxury_placeholder' }
};

const JSON_TIERS_PATH = path.join(process.cwd(), 'data', 'tiers.persistent.json');

async function getTiers(): Promise<TiersConfig> {
    try {
        const result = await query('SELECT id, name, "limit", price, stripe_price_id FROM tiers_config');
        if (result && result.rows && result.rows.length > 0) {
            const config: any = {};
            result.rows.forEach((row: any) => {
                config[row.id.toUpperCase()] = {
                    name: row.name,
                    limit: parseInt(row.limit, 10),
                    price: parseFloat(row.price),
                    stripePriceId: row.stripe_price_id || ''
                };
            });
            // Ensure all default keys exist
            for (const key of ['FREE', 'STANDARD', 'PREMIUM', 'LUXURY']) {
                if (!config[key]) {
                    config[key] = { ...DEFAULT_TIERS[key as keyof TiersConfig] };
                }
            }
            return config;
        }
    } catch (e: any) {
        console.warn('⚠️ SQL query for tiers_config failed, falling back to JSON:', e.message);
    }

    // JSON fallback
    try {
        if (fs.existsSync(JSON_TIERS_PATH)) {
            const content = fs.readFileSync(JSON_TIERS_PATH, 'utf8');
            const parsed = JSON.parse(content);
            if (parsed.FREE) {
                return parsed as TiersConfig;
            }
        }
    } catch (jsonErr: any) {
        console.error('Failed to read tiers.persistent.json:', jsonErr.message);
    }

    return { ...DEFAULT_TIERS };
}

async function saveTiers(config: TiersConfig): Promise<void> {
    // 1. Save to JSON fallback
    try {
        fs.writeFileSync(JSON_TIERS_PATH, JSON.stringify(config, null, 2), 'utf8');
        console.log('✅ Saved tiers to tiers.persistent.json');
    } catch (jsonErr: any) {
        console.error('Failed to write to tiers.persistent.json:', jsonErr.message);
    }

    // 2. Save to database
    try {
        for (const [id, info] of Object.entries(config)) {
            await query(
                `INSERT INTO tiers_config (id, name, "limit", price, stripe_price_id) 
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (id) DO UPDATE 
                 SET name = EXCLUDED.name, "limit" = EXCLUDED.limit, price = EXCLUDED.price, stripe_price_id = EXCLUDED.stripe_price_id`,
                [id.toUpperCase(), info.name, info.limit, info.price, info.stripePriceId]
            );
        }
        console.log('✅ Saved tiers to database');
    } catch (e: any) {
        console.warn('⚠️ Failed to save tiers to database, relying on JSON fallback:', e.message);
    }
}

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
            ALTER TABLE users ADD COLUMN IF NOT EXISTS session_token VARCHAR(255);
            ALTER TABLE materials ADD COLUMN IF NOT EXISTS price_contractor DECIMAL(10, 2);
            CREATE TABLE IF NOT EXISTS user_memories (
                user_id INTEGER PRIMARY KEY,
                last_state JSON DEFAULT ('{}'),
                history JSON DEFAULT ('[]'),
                behaviors JSON DEFAULT ('{}'),
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS tiers_config (
                id VARCHAR(50) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                "limit" INTEGER NOT NULL,
                price DECIMAL(10, 2) NOT NULL,
                stripe_price_id VARCHAR(255) DEFAULT ''
            );
        `);
        console.log('✅ Database migrations applied');
        
        // Seed initial tiers config
        const current = await getTiers();
        await saveTiers(current);
        console.log('✅ Pricing tiers initialized');
    } catch (e: any) {
        console.warn('⚠️ Migration failed (likely no DB connection):', e.message);
        
        // Ensure local folder and fallback file are initialized anyway
        try {
            const dataDir = path.join(process.cwd(), 'data');
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
            if (!fs.existsSync(JSON_TIERS_PATH)) {
                fs.writeFileSync(JSON_TIERS_PATH, JSON.stringify(DEFAULT_TIERS, null, 2), 'utf8');
                console.log('✅ Persistent JSON tiers created as fallback');
            }
        } catch (dirErr) {
            console.error('Failed to create local tiers backup:', dirErr);
        }
    }
}
runMigrations();

// Define path variables that are tracked by Git (initial seed data)
const JSON_PRODUCTS_TRACKED = fs.existsSync(path.join(process.cwd(), 'public', 'data', 'products.json'))
    ? path.join(process.cwd(), 'public', 'data', 'products.json')
    : path.join(process.cwd(), 'data', 'products.json');

const JSON_USERS_TRACKED = fs.existsSync(path.join(process.cwd(), 'public', 'data', 'users.json'))
    ? path.join(process.cwd(), 'public', 'data', 'users.json')
    : path.join(process.cwd(), 'data', 'users.json');

// Define persistent, untracked fallback paths to prevent git pull from overwriting deletions
const JSON_DB_PATH = path.join(process.cwd(), 'data', 'products.persistent.json');
const JSON_USERS_PATH = path.join(process.cwd(), 'data', 'users.persistent.json');
const JSON_MEMORIES_PATH = path.join(process.cwd(), 'data', 'memories.persistent.json');
const JSON_PRODUCTS_PATH = JSON_DB_PATH;

// Initialize persistent files on startup if they don't exist
try {
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    if (!fs.existsSync(JSON_DB_PATH) && fs.existsSync(JSON_PRODUCTS_TRACKED)) {
        fs.copyFileSync(JSON_PRODUCTS_TRACKED, JSON_DB_PATH);
        console.log('✅ Initialized products.persistent.json from tracked products.json');
    }
    if (!fs.existsSync(JSON_USERS_PATH) && fs.existsSync(JSON_USERS_TRACKED)) {
        fs.copyFileSync(JSON_USERS_TRACKED, JSON_USERS_PATH);
        console.log('✅ Initialized users.persistent.json from tracked users.json');
    }
    if (!fs.existsSync(JSON_MEMORIES_PATH)) {
        fs.writeFileSync(JSON_MEMORIES_PATH, JSON.stringify({}, null, 2), 'utf8');
        console.log('✅ Initialized memories.persistent.json');
    }
} catch (initErr) {
    console.error('Failed to initialize persistent JSON fallbacks:', initErr);
}

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
    totalUsers: number;
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
        configFile: { ok: !!findConfigPath() || config.ok, path: findConfigPath() },
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
      // Only care about API Key being healthy for Telegram alerts
      const currentStatus = health.checks.apiKey.ok;
      
      if (currentStatus !== this.lastStatus) {
        if (!currentStatus) {
           await telegramAlerts.sendErrorAlert(new Error("AI Key Failure"), `The AI API Key is missing or invalid (active provider: ${health.checks.apiKey.message})`);
        }
        this.lastStatus = currentStatus;
      }
    } catch (e) {}
  }

  private async checkConfig() {
    try {
      const configPath = findConfigPath();
      let config: any = {};

      if (configPath) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }

      const provider = config.AI_PROVIDER || 'gemini';
      const geminiKey = config.GEMINI_API_KEY || process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
      const openaiKey = config.OPENAI_API_KEY || process.env.OPENAI_API_KEY;

      if (provider === 'openai') {
        if (!openaiKey) return { ok: false, message: 'AI_PROVIDER is openai but OPENAI_API_KEY not found in config or env' };
        if (!openaiKey.startsWith('sk-')) return { ok: false, message: 'OpenAI API key format invalid (should start with sk-)' };
        return { ok: true, message: `OpenAI key valid (active provider: ${provider})` };
      }

      // Default: Gemini
      if (!geminiKey) return { ok: false, message: 'GEMINI_API_KEY not found in config or env' };
      if (!geminiKey.startsWith('AIza')) return { ok: false, message: 'Gemini API key format invalid (should start with AIza)' };
      return { ok: true, message: `Gemini key valid (active provider: ${provider})` };
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
        if (!process.env.DB_HOST) {
          return { ok: false, message: 'MySQL host not configured (running in high-fidelity local JSON mode)' };
        }
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
}, 2000);

// Set up proactive monitoring intervals
setInterval(() => monitor.checkAndReport(), 300000); // Check every 5 mins for AI key failure

// Helper to get config (API Keys, etc.)
async function getConfig() {
    return loadConfig();
}

// Helper to load from JSON (fallback persistence)
function loadFromJSON(filePath: string) {
    try {
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error(`Error loading from ${filePath}:`, e);
    }
    return [];
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

// Helper to map DB row to Material interface
function mapDBToMaterial(row: any) {
    if (!row) return null;
    return {
        id: String(row.id),
        refCode: row.ref_code || row.refCode || '',
        name: row.name || '',
        description: row.description || '',
        imageUrl: (row.image_url || row.imageUrl || '').startsWith('/products/') ? 'https://buildingapp.us' + (row.image_url || row.imageUrl) : (row.image_url || row.imageUrl || ''),
        category: row.category || '',
        subcategory: row.subcategory || '',
        usage: row.usage || 'Interior',
        promptModifier: row.prompt_modifier || row.promptModifier || '',
        pricing: {
            pricePerUnit: Number(row.price || 0),
            priceContractor: Number(row.price_contractor || row.price || 0),
            currency: row.currency || 'USD',
            unitLabel: row.unit || row.unitLabel || 'Unidad',
            itemsPerBox: Number(row.items_per_box || 1)
        },
        dimensions: {
            width: Number(row.width_cm || row.width || 0),
            length: Number(row.length_cm || row.length || 0),
            thickness: Number(row.thickness_m || row.thickness || 0)
        }
    };
}

// Helper to get materials from DB or JSON
async function getMaterials() {
    try {
        const result = await query('SELECT * FROM materials ORDER BY category, name');
        return result.rows.map(mapDBToMaterial);
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

// ===== SECURITY AUDIT LOGGING & AUTHORIZATION MIDDLEWARE =====

// Define persistent untracked fallback path for audit logs
const JSON_AUDIT_LOGS_PATH = path.join(process.cwd(), 'data', 'audit_logs.persistent.json');
try {
    if (!fs.existsSync(JSON_AUDIT_LOGS_PATH)) {
        fs.writeFileSync(JSON_AUDIT_LOGS_PATH, JSON.stringify([], null, 2), 'utf8');
        console.log('✅ Initialized audit_logs.persistent.json');
    }
} catch (e: any) {
    console.error('Failed to initialize audit_logs.persistent.json:', e.message);
}

// Log admin action to JSON file and send Telegram alert
async function logAdminAction(req: Request, user: any, action: string, details: string) {
    try {
        const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
        const logEntry = {
            id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            timestamp: new Date().toISOString(),
            adminEmail: user?.email || 'system@buildingapp.us',
            adminName: user?.name || 'System',
            action,
            details,
            ipAddress: Array.isArray(ipAddress) ? ipAddress[0] : String(ipAddress)
        };

        // 1. Append to JSON
        let logs: any[] = [];
        if (fs.existsSync(JSON_AUDIT_LOGS_PATH)) {
            try {
                const content = fs.readFileSync(JSON_AUDIT_LOGS_PATH, 'utf8');
                logs = JSON.parse(content || '[]');
            } catch (err) {
                logs = [];
            }
        }
        logs.unshift(logEntry);
        if (logs.length > 1000) logs = logs.slice(0, 1000);
        fs.writeFileSync(JSON_AUDIT_LOGS_PATH, JSON.stringify(logs, null, 2), 'utf8');

        // 2. Send Telegram notification
        try {
            await telegramAlerts.sendMessage({
                text: `<b>⚠️ [Admin Security Audit]</b>\n\n` +
                      `<b>Admin:</b> ${logEntry.adminName} (${logEntry.adminEmail})\n` +
                      `<b>Action:</b> <code>${logEntry.action}</code>\n` +
                      `<b>Details:</b> ${logEntry.details}\n` +
                      `<b>IP Address:</b> <code>${logEntry.ipAddress}</code>\n` +
                      `<b>Time:</b> ${new Date(logEntry.timestamp).toLocaleString()}\n\n` +
                      `<a href="https://buildingapp.us/api/admin/dashboard?token=${user?.session_token || 'session_admin_fallback'}">Go to Admin Dashboard</a>`,
                parse_mode: 'HTML'
            });
        } catch (tgErr) {
            console.error('Failed to send audit log Telegram alert:', tgErr);
        }
    } catch (e: any) {
        console.error('Failed to log admin action:', e);
    }
}

// Security Middleware: Require standard authorization (matching user OR admin)
const requireAuth = async (req: Request, res: Response, next: any) => {
    try {
        let token = '';
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
            token = req.headers.authorization.substring(7);
        } else if (req.query.token) {
            token = req.query.token as string;
        }

        if (!token) {
            return res.status(401).json({ error: 'Unauthorized. No session token provided.' });
        }

        let user: any = null;
        try {
            const result = await query('SELECT id, name, email, phone, address, role, tier, generations_used, session_token FROM users WHERE session_token = $1', [token]);
            if (result.rows.length > 0) {
                user = result.rows[0];
            }
        } catch (dbErr) {}

        if (!user) {
            const users = await getUsers();
            user = users.find((u: any) => u.session_token === token);
        }

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

// Security Middleware: Require admin role
const requireAdmin = async (req: Request, res: Response, next: any) => {
    try {
        let token = '';
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
            token = req.headers.authorization.substring(7);
        } else if (req.query.token) {
            token = req.query.token as string;
        }

        if (!token) {
            return res.status(401).json({ error: 'Unauthorized. No session token provided.' });
        }

        let user: any = null;
        try {
            const result = await query('SELECT id, name, email, phone, address, role, tier, generations_used, session_token FROM users WHERE session_token = $1', [token]);
            if (result.rows.length > 0) {
                user = result.rows[0];
            }
        } catch (dbErr) {}

        if (!user) {
            const users = await getUsers();
            user = users.find((u: any) => u.session_token === token);
        }

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

// Middleware + Monitoring + Security
const allowedOrigins = ['https://buildingapp.us', 'https://www.buildingapp.us', 'http://localhost:5173', 'http://localhost:3000'];
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));

// Global request timeout — 60s for API routes, 5min for AI/image routes
app.use((req: Request, res: Response, next: any) => {
    const isLongRunning = req.path.includes('/ai/') || req.path.includes('/proxy-image');
    req.setTimeout(isLongRunning ? 300000 : 60000, () => {
        res.status(408).json({ error: 'Request timeout' });
    });
    next();
});
// Stripe Webhook Endpoint (Must use raw body for signature verification)
let stripeInstance: Stripe | null = null;
let lastStripeKey: string | null = null;

async function getStripe() {
    const config = await getConfig();
    const key = config.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY || 'sk_test_123';
    
    if (!stripeInstance || lastStripeKey !== key) {
        stripeInstance = new Stripe(key, { apiVersion: '2025-02-24.acacia' as any });
        lastStripeKey = key;
    }
    return stripeInstance;
}

async function getStripeWebhookSecret() {
    const config = await getConfig();
    return config.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET || 'whsec_123';
}

app.post('/api/webhooks/stripe', express.raw({type: 'application/json'}), async (req: Request, res: Response) => {
    const sig = req.headers['stripe-signature'] as string;
    let event;

    try {
        const stripeObj = await getStripe();
        const webhookSecret = await getStripeWebhookSecret();
        event = stripeObj.webhooks.constructEvent(req.body, sig, webhookSecret);
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
                const tier = session.metadata?.tier || (session.amount_total > 4000 ? 'LUXURY' : 'PREMIUM'); // Fallback to amount if metadata missing
                
                // 1. Try DB first
                try {
                    await query('UPDATE users SET tier = $1 WHERE id = $2', [tier, userId]);
                    console.log(`Successfully upgraded tier in DB for user ${userId}`);
                } catch (dbErr: any) {
                    console.warn(`Failed to upgrade tier in DB for user ${userId}, continuing to JSON:`, dbErr.message);
                }

                // 2. Always update JSON as fallback (critical on Hostinger where DB fails)
                try {
                    const users = await getUsers();
                    const index = users.findIndex((u: any) => String(u.id) === String(userId));
                    if (index !== -1) {
                        users[index].tier = tier;
                        saveToJSON(JSON_USERS_PATH, users);
                        console.log(`Successfully upgraded tier in JSON for user ${userId}`);
                    } else {
                        console.warn(`User ${userId} not found in JSON fallback`);
                    }
                } catch (jsonErr: any) {
                    console.error(`Failed to upgrade tier in JSON for user ${userId}:`, jsonErr);
                }
            } catch (e: any) {
                console.error(`Error processing tier upgrade for user ${userId}:`, e);
            }
        }
    }

    res.json({received: true});
});

app.post('/api/checkout/create-session', express.json(), async (req: Request, res: Response) => {
    try {
        const { userId, tier } = req.body;
        if (!userId || !tier) {
            return res.status(400).json({ error: 'Missing userId or tier' });
        }

        const config = await getConfig();
        const secretKey = config.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY;

        const tiers = await getTiers();
        const matchedTier = Object.values(tiers).find(
            (t: any) => t.name.toLowerCase() === tier.toLowerCase() || 
                       t.name.split(' ')[0].toLowerCase() === tier.toLowerCase() ||
                       t.name.includes(`(${tier})`) ||
                       (tier.toLowerCase() === 'pro' && t.name.toLowerCase().includes('pro')) ||
                       (tier.toLowerCase() === 'enterprise' && t.name.toLowerCase().includes('enterprise'))
        ) || (tiers as any)[tier.toUpperCase()];

        let stripePriceId = matchedTier ? matchedTier.stripePriceId : '';

        // Fallback to .env variables if the tier has a placeholder or empty ID
        if (!stripePriceId || stripePriceId.includes('_placeholder')) {
            const tierUpper = tier.toUpperCase();
            if (tierUpper.includes('PREMIUM') || tierUpper.includes('PRO')) {
                stripePriceId = process.env.STRIPE_PRICE_PRO || stripePriceId;
            } else if (tierUpper.includes('LUXURY') || tierUpper.includes('ENTERPRISE')) {
                stripePriceId = process.env.STRIPE_PRICE_ENTERPRISE || stripePriceId;
            }
        }

        // If key is missing, placeholder, or the Price ID is not configured, fall back to mock mode
        if (!secretKey || secretKey === 'sk_test_123' || !stripePriceId || (stripePriceId.startsWith('price_') && stripePriceId.includes('_placeholder'))) {
            return res.json({
                isMock: true,
                sessionId: `mock_${Date.now()}`,
                tier: tier
            });
        }

        const baseUrl = req.headers.origin || req.headers.referer || 'http://localhost:3000';
        const stripeObj = await getStripe();
        const session = await stripeObj.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price: stripePriceId,
                    quantity: 1,
                },
            ],
            mode: 'subscription',
            success_url: `${baseUrl}/?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${baseUrl}/`,
            client_reference_id: String(userId),
            metadata: {
                tier: tier
            }
        });

        res.json({ id: session.id, url: session.url });
    } catch (e: any) {
        console.error('Checkout Session error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/checkout/create-product-session', express.json(), async (req: Request, res: Response) => {
    try {
        const { items, userId, email, name } = req.body;
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Missing or empty items' });
        }

        const config = await getConfig();
        const secretKey = config.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY;

        // Check if Stripe is properly configured (not placeholder key)
        if (!secretKey || secretKey === 'sk_test_123') {
            return res.json({
                isMock: true,
                sessionId: `mock_product_${Date.now()}`,
                items: items.map((item: any) => ({
                    name: item.material?.name || 'Unknown',
                    quantity: item.quantity,
                    totalCost: item.totalCost
                }))
            });
        }

        // Build line items from cart — each cart item becomes a Stripe line item
        const lineItems = items.map((item: any) => {
            const unitPrice = Number(item.material?.pricing?.pricePerUnit) || 0;
            const qty = Number(item.quantity) || 1;
            const totalCost = Number(item.totalCost) || 0;
            const unitAmount = totalCost > 0 && qty > 0
                ? Math.round((totalCost / qty) * 100)
                : Math.round(unitPrice * 100);
            return {
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: `${item.material?.name || 'Material'} — ${item.dimensions ? `${item.dimensions.width}m × ${item.dimensions.height}m` : 'Custom'}`,
                        description: `${qty} ${item.material?.pricing?.unitLabel || 'units'} @ $${unitPrice.toFixed(2)}/unit`,
                        ...(item.material?.imageUrl ? { images: [item.material.imageUrl] } : {})
                    },
                    unit_amount: unitAmount || 1, // Stripe requires at least 1 cent
                },
                quantity: qty,
            };
        }).filter((li: any) => li.price_data.unit_amount > 0);

        const baseUrl = req.headers.origin || `https://${req.headers.host}` || 'https://buildingapp.us';
        const stripeObj = await getStripe();
        const session = await stripeObj.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: lineItems,
            mode: 'payment',
            success_url: `${baseUrl}/?session_id={CHECKOUT_SESSION_ID}&status=success`,
            cancel_url: `${baseUrl}/cart`,
            customer_email: email,
            client_reference_id: String(userId || 'guest'),
            metadata: {
                userId: String(userId || 'guest'),
                customerName: name || '',
                itemCount: String(items.length),
            }
        });

        res.json({ id: session.id, url: session.url });
    } catch (e: any) {
        console.error('Product Checkout Session error:', e);
        res.status(500).json({ error: e.message });
    }
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
app.get('/api/admin/health', requireAdmin, async (req: Request, res: Response) => {
    try {
        const health = await monitor.getHealth();
        res.json(health);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// Visual HTML dashboard
app.get('/api/admin/dashboard', requireAdmin, async (req: Request, res: Response) => {
    try {
        const health = await monitor.getHealth();
        
        // Read recent 15 audit logs
        let logs: any[] = [];
        if (fs.existsSync(JSON_AUDIT_LOGS_PATH)) {
            try {
                const content = fs.readFileSync(JSON_AUDIT_LOGS_PATH, 'utf8');
                logs = JSON.parse(content || '[]');
            } catch (err) {}
        }
        const recentLogs = logs.slice(0, 15);

        // Generate logs HTML
        let logsHtml = '';
        if (recentLogs.length === 0) {
            logsHtml = '<div style="color: #666; font-style: italic; padding: 10px 0;">No audit logs recorded yet.</div>';
        } else {
            logsHtml = `
            <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px;">
                <thead>
                    <tr style="border-bottom: 2px solid #222; color: #888; font-weight: bold; text-transform: uppercase; font-size: 11px;">
                        <th style="padding: 10px 5px;">Time</th>
                        <th style="padding: 10px 5px;">Admin</th>
                        <th style="padding: 10px 5px;">Action</th>
                        <th style="padding: 10px 5px;">Details</th>
                        <th style="padding: 10px 5px;">IP</th>
                    </tr>
                </thead>
                <tbody style="color: #ccc;">
                    ${recentLogs.map((l: any) => {
                        let color = '#a8a29e';
                        if (l.action.includes('DELETE')) color = '#ef4444';
                        else if (l.action.includes('CREATE') || l.action.includes('ADD')) color = '#10b981';
                        else if (l.action.includes('UPDATE')) color = '#f59e0b';
                        else if (l.action.includes('CONFIG')) color = '#3b82f6';
                        
                        return `
                        <tr style="border-bottom: 1px solid #1c1c1c;">
                            <td style="padding: 10px 5px; font-family: monospace; font-size: 11px; color: #666; white-space: nowrap;">${new Date(l.timestamp).toLocaleString()}</td>
                            <td style="padding: 10px 5px; font-weight: bold;">${l.adminName}<br><span style="font-size: 11px; color: #666; font-weight: normal;">${l.adminEmail}</span></td>
                            <td style="padding: 10px 5px;"><span style="color: ${color}; font-family: monospace; font-weight: bold; font-size: 11px;">${l.action}</span></td>
                            <td style="padding: 10px 5px; color: #aaa;">${l.details}</td>
                            <td style="padding: 10px 5px; font-family: monospace; font-size: 11px; color: #666;">${l.ipAddress}</td>
                        </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>`;
        }

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
                    <span>Config File: ${health.checks.configFile.path ? 'Found' : (health.checks.apiKey.ok ? 'Missing (Using environment variables)' : 'Missing')}</span>
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
                <div class="metric"><a href="/api/admin/health?token=${req.query.token}" style="color:#2563eb">/api/admin/health (JSON)</a></div>
            </div>
        </div>

        <div class="card" style="margin-top: 30px; grid-column: span 1 / -1; width: 100%;">
            <h3 style="color: #ef4444; border-bottom: 1px solid #222; padding-bottom: 10px; margin-bottom: 15px; display: flex; align-items: center; gap: 8px;">
                <svg style="width: 18px; height: 18px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
                Security Audit Log (Last 15 Entries)
            </h3>
            ${logsHtml}
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
app.get('/api/admin/report', requireAdmin, (req: Request, res: Response) => {
    const report = monitor.getDailyReport();
    res.json(report);
});

// Test Telegram configuration
app.get('/api/admin/test-telegram', requireAdmin, async (req: Request, res: Response) => {
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
app.get('/api/admin/status', requireAdmin, (req: Request, res: Response) => {
    res.json({
        app: {
            name: 'BuildingApp',
            version: '0.0.0',
            commit: BUILD_COMMIT,
            nodeEnv: process.env.NODE_ENV || 'development',
            port: PORT,
            uptime: Math.floor(process.uptime()),
        },
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

function pushGenerationLog(entry: typeof generationLog[0]) {
    generationLog.push(entry);
    if (generationLog.length > 500) generationLog.shift();
}

app.get('/api/admin/analytics', requireAdmin, async (req: Request, res: Response) => {
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

const getImageBase64 = async (urlPath: string): Promise<{ data: string; mimeType: string } | null> => {
    try {
        if (!urlPath) return null;
        
        // Handle HTTP/HTTPS URLs
        if (urlPath.startsWith('http://') || urlPath.startsWith('https://')) {
            const response = await fetch(urlPath);
            if (!response.ok) throw new Error(`Failed to fetch remote image: ${response.statusText}`);
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const mimeType = response.headers.get('content-type') || 'image/jpeg';
            return { data: buffer.toString('base64'), mimeType };
        }

        // Handle local paths
        const cleanPath = urlPath.startsWith('/') ? urlPath.substring(1) : urlPath;
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
        console.warn(`Could not load image: ${urlPath}`, e);
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

// Get API key for Gemini — delegates to unified config loader
const getServerApiKey = (): string => {
    const config = loadConfig();
    return config.GEMINI_API_KEY;
};

// POST /api/ai/generate-overlay — Multi-provider AI image generation
app.post("/api/ai/generate-overlay", async (req: Request, res: Response) => {
    try {
        const { originalImage, material, userInstruction, renderOptions, lang, userId, provider: userProvider } = req.body;

        // Input validation: image must be a valid data URL and under 5MB
        if (originalImage && typeof originalImage === 'string') {
            const match = originalImage.match(/^data:(image\/(jpeg|png|webp));base64,(.+)$/);
            if (!match) {
                return res.status(400).json({ error: 'Invalid image format. Must be base64 data URL (jpeg, png, webp).' });
            }
            const base64Data = match[3];
            const approxBytes = (base64Data.length * 3) / 4;
            if (approxBytes > 5 * 1024 * 1024) {
                return res.status(413).json({ error: 'Image too large. Max 5MB.' });
            }
        }
        
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

        // Load config and determine provider
        const config = loadConfig();
        const provider = (userProvider as AIProvider) || config.AI_PROVIDER || "gemini";
        
        // Validate that the selected provider has an API key
        if (provider === "openai" && !config.OPENAI_API_KEY) {
            return res.status(500).json({ 
                error: "OpenAI API Key not configured. Please contact administrator or switch provider." 
            });
        }
        if (provider === "gemini" && !config.GEMINI_API_KEY) {
            return res.status(500).json({ 
                error: "Gemini API Key not configured. Please contact administrator or switch provider." 
            });
        }

        // Generate via provider abstraction
        const result = await generateOverlay({
            originalImage,
            material,
            userInstruction: userInstruction || "",
            renderOptions,
        }, provider, config);

        // Log successful generation
        pushGenerationLog({
            timestamp: new Date().toISOString(),
            userId,
            materialId: material?.id || material?.refCode,
            materialName: material?.name,
            category: material?.category,
            success: true,
            durationMs: result.durationMs,
            model: `${provider}/${result.model}`,
        });
        
        res.json({ success: true, image: result.image, provider, model: result.model });
        
    } catch (error: any) {
        pushGenerationLog({
            timestamp: new Date().toISOString(),
            userId: req.body?.userId,
            materialId: req.body?.material?.id || req.body?.material?.refCode,
            materialName: req.body?.material?.name,
            category: req.body?.material?.category,
            success: false,
            durationMs: 0,
            model: "error",
            error: getErrorMessage(error),
        });

        console.error("AI Generation failed:", error);
        res.status(500).json({ error: getErrorMessage(error) });
    }
});

// POST /api/ai/analyze-room — Multi-provider room analysis
app.post("/api/ai/analyze-room", async (req: Request, res: Response) => {
    try {
        const { image, userId, lang, provider: userProvider } = req.body;

        // Input validation: image must be a valid data URL and under 5MB
        if (image && typeof image === 'string') {
            const match = image.match(/^data:(image\/(jpeg|png|webp));base64,(.+)$/);
            if (!match) {
                return res.status(400).json({ error: 'Invalid image format. Must be base64 data URL (jpeg, png, webp).' });
            }
            const base64Data = match[3];
            const approxBytes = (base64Data.length * 3) / 4;
            if (approxBytes > 5 * 1024 * 1024) {
                return res.status(413).json({ error: 'Image too large. Max 5MB.' });
            }
        }
        
        if (userId) {
            const quota = await checkAndIncrementQuota(userId);
            if (!quota.allowed) {
                return res.status(403).json({ error: "Quota exceeded" });
            }
        }

        const config = loadConfig();
        const provider = (userProvider as AIProvider) || config.AI_PROVIDER || "gemini";

        if (provider === "openai" && !config.OPENAI_API_KEY) {
            return res.status(500).json({ error: "OpenAI API Key not configured" });
        }
        if (provider === "gemini" && !config.GEMINI_API_KEY) {
            return res.status(500).json({ error: "Gemini API Key not configured" });
        }

        const result = await analyzeRoom({ image, lang }, provider, config);

        res.json({ success: true, analysis: result.analysis, provider, model: result.model });
        
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
app.post('/api/materials', requireAdmin, async (req: Request, res: Response) => {
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
            
            await logAdminAction(req, (req as any).user, 'CREATE_MATERIAL', `Created material: ${name} (SKU: ${ref_code})`);
            return res.status(201).json(result.rows[0]);
        } catch (dbError) {
            console.warn('DB Insert failed, updating JSON fallback...');
            const materials = await getMaterials();
            const newItem = { id: `mat-${Date.now()}`, ...req.body, created_at: new Date().toISOString() };
            materials.unshift(newItem);
            saveToJSON(JSON_DB_PATH, materials);
            
            await logAdminAction(req, (req as any).user, 'CREATE_MATERIAL', `Created material (fallback): ${name} (SKU: ${ref_code})`);
            return res.status(201).json(newItem);
        }
    } catch (error: any) {
        console.error('Create material error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update material
app.put('/api/materials/:id', requireAdmin, async (req: Request, res: Response) => {
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
        
        await logAdminAction(req, (req as any).user, 'UPDATE_MATERIAL', `Updated material ID ${id} (${name}, SKU: ${ref_code})`);
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
app.delete('/api/materials/:id', requireAdmin, async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        let deletedLocally = false;
        
        // Helper to sync deletions to the original tracked JSON seed file
        const syncToTrackedJSON = (deletedId: string) => {
            try {
                if (fs.existsSync(JSON_PRODUCTS_TRACKED)) {
                    const trackedData = JSON.parse(fs.readFileSync(JSON_PRODUCTS_TRACKED, 'utf8'));
                    const filteredTracked = trackedData.filter((m: any) => 
                        String(m.id) !== String(deletedId) && 
                        String(m.refCode || m.ref_code || '') !== String(deletedId)
                    );
                    if (filteredTracked.length < trackedData.length) {
                        fs.writeFileSync(JSON_PRODUCTS_TRACKED, JSON.stringify(filteredTracked, null, 2), 'utf8');
                        deletedLocally = true;
                    }
                }
            } catch (e) {
                console.warn('Failed to sync deletion to tracked JSON:', e);
            }
        };

        try {
            // Try deleting by numeric ID or by RefCode (SKU)
            const result = await query('DELETE FROM materials WHERE id = $1 OR ref_code = $2 RETURNING id', [id, (id as string)]);
            
            // Sync to JSON fallback if we have a DB connection
            const all = await query('SELECT * FROM materials ORDER BY category, name');
            const mapped = all.rows.map(mapDBToMaterial);
            saveToJSON(JSON_DB_PATH, mapped);
            
            // Sync to original tracked file to ensure permanence across repo clones
            syncToTrackedJSON(id);
            
            await logAdminAction(req, (req as any).user, 'DELETE_MATERIAL', `Deleted material ID/SKU ${id}`);
            
            if (result.rows.length === 0) {
                throw new Error('Not found in DB');
            }
            res.json({ success: true, id: result.rows[0].id, permanentlyDeleted: deletedLocally });
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
            syncToTrackedJSON(id);
            
            await logAdminAction(req, (req as any).user, 'DELETE_MATERIAL', `Deleted material ID/SKU ${id} (fallback)`);
            res.json({ success: true, id, note: 'Deleted from JSON fallback', permanentlyDeleted: deletedLocally });
        }
    } catch (error: any) {
        console.error('Delete material error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Bulk import materials
app.post('/api/materials/bulk', requireAdmin, async (req: Request, res: Response) => {
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

        await logAdminAction(req, (req as any).user, 'BULK_CREATE_MATERIALS', `Imported ${materials.length} materials via bulk upload`);
        res.json({ success: true, imported });
    } catch (error: any) {
        console.error('Bulk import error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete all materials (factory reset)
app.delete('/api/materials', requireAdmin, async (req: Request, res: Response) => {
    try {
        await query('DELETE FROM materials');
        
        await logAdminAction(req, (req as any).user, 'RESET_ALL_DATA', 'Factory reset: Deleted all materials from the database');
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

        let sqlQuery = 'SELECT * FROM purchase_requests';
        const params: any[] = [];

        if (status) {
            sqlQuery += ' WHERE status = $1';
            params.push(status);
        }

        sqlQuery += ' ORDER BY created_at DESC';

        const result = await query(sqlQuery, params);

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
        const result = await query('SELECT * FROM purchase_requests WHERE id = $1', [(id as string)]);

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

        const sessionToken = 'session_' + Math.random().toString(36).substr(2, 9) + Math.random().toString(36).substr(2, 9);

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
                `INSERT INTO users (name, email, phone, address, password_hash, role, tier, generations_used, session_token)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id, name, email, phone, address, role, tier, generations_used, session_token, created_at`,
                [name, email, phone || null, address || null, hashedPassword, 'customer', 'Free', 0, sessionToken]
            );

            // Send Telegram notification for new user signup
            try {
                await telegramAlerts.sendMessage({
                    text: `<b>👤 New User Registered</b>\n\n` +
                          `<b>Name:</b> ${name}\n` +
                          `<b>Email:</b> ${email}\n` +
                          `<b>Phone:</b> ${phone || 'N/A'}\n` +
                          `<b>Address:</b> ${address || 'N/A'}\n` +
                          `<b>Tier:</b> Free\n` +
                          `<b>Database:</b> PostgreSQL\n` +
                          `<b>Time:</b> ${new Date().toLocaleTimeString()}\n\n` +
                          `<a href="https://buildingapp.us/api/admin/dashboard?token=session_admin_fallback">View Dashboard</a>`,
                    parse_mode: 'HTML'
                });
            } catch (tgError) {
                console.error('Failed to send signup Telegram alert:', tgError);
            }

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
                session_token: sessionToken,
                created_at: new Date().toISOString()
            };

            users.push(newUser);
            saveToJSON(JSON_USERS_PATH, users);

            // Send Telegram notification for new user signup (JSON fallback)
            try {
                await telegramAlerts.sendMessage({
                    text: `<b>👤 New User Registered</b>\n\n` +
                          `<b>Name:</b> ${name}\n` +
                          `<b>Email:</b> ${email}\n` +
                          `<b>Phone:</b> ${phone || 'N/A'}\n` +
                          `<b>Address:</b> ${address || 'N/A'}\n` +
                          `<b>Tier:</b> Free\n` +
                          `<b>Database:</b> High-Fidelity JSON Fallback\n` +
                          `<b>Time:</b> ${new Date().toLocaleTimeString()}\n\n` +
                          `<a href="https://buildingapp.us/api/admin/dashboard?token=session_admin_fallback">View Dashboard</a>`,
                    parse_mode: 'HTML'
                });
            } catch (tgError) {
                console.error('Failed to send signup Telegram alert (fallback):', tgError);
            }

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

        const sessionToken = 'session_' + Math.random().toString(36).substr(2, 9) + Math.random().toString(36).substr(2, 9);

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

                // Save session token to DB
                try {
                    await query('UPDATE users SET session_token = $1 WHERE id = $2', [sessionToken, user.id]);
                } catch (updateErr: any) {
                    console.warn('Failed to save session token to DB:', updateErr.message);
                }

                const { password_hash, ...userResponse } = user;
                return res.json({ 
                    user: { 
                        ...userResponse, 
                        session_token: sessionToken 
                    } 
                });
            }
            
            // If not in DB, check JSON fallback anyway (might be newly signed up in fallback)
            throw new Error('Not found in DB');
            
        } catch (dbError) {
            console.warn('Login DB unavailable or user not found, checking JSON fallback...');
            const users = await getUsers();
            const index = users.findIndex((u: any) => u.email === email);

            if (index === -1) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            const user = users[index];
            const isMatch = await bcrypt.compare(password, user.password_hash);
            if (!isMatch) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            // Save session token in JSON
            user.session_token = sessionToken;
            saveToJSON(JSON_USERS_PATH, users);

            const { password_hash, ...userResponse } = user;
            return res.json({ 
                user: { 
                    ...userResponse, 
                    session_token: sessionToken 
                } 
            });
        }
    } catch (error: any) {
        console.error('Login error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== MATERIAL MANAGEMENT API v2 (consolidated — uses getMaterials helper) =====
// All duplicate handlers removed; single source of truth at lines 1667-1910


app.patch('/api/admin/users/:id/generations', requireAdmin, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { generations_used } = req.body;

        if (typeof generations_used !== 'number') {
            return res.status(400).json({ error: 'Invalid generation count' });
        }

        // Get user email for audit log
        let userEmail = 'unknown';
        try {
            const uResult = await query('SELECT email FROM users WHERE id = $1', [id]);
            if (uResult.rows.length > 0) userEmail = uResult.rows[0].email;
        } catch (e) {}
        if (userEmail === 'unknown') {
            try {
                const fallbackUsers = await getUsers();
                const foundU = fallbackUsers.find((u: any) => String(u.id) === String(id));
                if (foundU) userEmail = foundU.email;
            } catch (e) {}
        }

        try {
            const result = await query(
                'UPDATE users SET generations_used = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id',
                [generations_used, (id as string)]
            );
            if (result.rows.length > 0) {
                await logAdminAction(req, (req as any).user, 'UPDATE_USER_GENERATIONS', `Updated generations used for user ID ${id} (${userEmail}) to ${generations_used}`);
                return res.json({ success: true });
            }
        } catch (dbErr: any) {
            console.warn('DB update generations failed, continuing to JSON fallback:', dbErr.message);
        }

        // Fallback to JSON database
        const users = await getUsers();
        const index = users.findIndex((u: any) => String(u.id) === String(id));
        if (index !== -1) {
            users[index].generations_used = generations_used;
            saveToJSON(JSON_USERS_PATH, users);
            await logAdminAction(req, (req as any).user, 'UPDATE_USER_GENERATIONS', `Updated generations used for user ID ${id} (${userEmail}) to ${generations_used} (fallback)`);
            return res.json({ success: true });
        }

        return res.status(404).json({ error: 'User not found' });
    } catch (error: any) {
        console.error('Update generations error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// User-facing tier update — for mock subscription upgrades (no Stripe)
app.patch('/api/users/:id/tier', requireAuth, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { tier } = req.body;

        // Users can only update their own tier
        if (String((req as any).user?.id) !== String(id)) {
            return res.status(403).json({ error: 'Can only update your own tier' });
        }

        const tiers = await getTiers();
        const validTiers = Object.keys(tiers).map(k => k.toUpperCase());
        const isTierValid = validTiers.includes(tier.toUpperCase()) || 
                            ['FREE', 'STANDARD', 'PREMIUM', 'LUXURY', 'PRO', 'ENTERPRISE'].includes(tier.toUpperCase()) ||
                            ['FREE', 'STANDARD', 'PREMIUM', 'LUXURY', 'PRO', 'ENTERPRISE'].includes(tier);
        if (!isTierValid) {
            return res.status(400).json({ error: 'Invalid tier' });
        }

        // Update tier in DB
        await query('UPDATE users SET tier = $1, updated_at = NOW() WHERE id = $2', [tier, id]);

        // Update in-memory user list
        try {
            const memResult = await getUsers();
            const memUser = memResult.find((u: any) => String(u.id) === String(id));
            if (memUser) memUser.tier = tier;
        } catch (e) {}

        console.log(`[tier-upgrade] User ${id} self-upgraded to ${tier}`);

        res.json({ tier, id, message: 'Tier updated' });
    } catch (e: any) {
        console.error('User tier update error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.patch('/api/admin/users/:id/tier', requireAdmin, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { tier } = req.body;

        const tiers = await getTiers();
        const validTiers = Object.keys(tiers).map(k => k.toUpperCase());
        const isTierValid = validTiers.includes(tier.toUpperCase()) || 
                            ['FREE', 'STANDARD', 'PREMIUM', 'LUXURY', 'PRO', 'ENTERPRISE'].includes(tier.toUpperCase()) ||
                            ['FREE', 'STANDARD', 'PREMIUM', 'LUXURY', 'PRO', 'ENTERPRISE'].includes(tier);
        if (!isTierValid) {
            return res.status(400).json({ error: 'Invalid tier' });
        }

        // Get user email for audit log
        let userEmail = 'unknown';
        try {
            const uResult = await query('SELECT email FROM users WHERE id = $1', [id]);
            if (uResult.rows.length > 0) userEmail = uResult.rows[0].email;
        } catch (e) {}
        if (userEmail === 'unknown') {
            try {
                const fallbackUsers = await getUsers();
                const foundU = fallbackUsers.find((u: any) => String(u.id) === String(id));
                if (foundU) userEmail = foundU.email;
            } catch (e) {}
        }

        try {
            const result = await query(
                'UPDATE users SET tier = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, name, email, tier',
                [tier, (id as string)]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'User not found' });
            }

            await logAdminAction(req, (req as any).user, 'UPDATE_USER_TIER', `Updated tier for user ID ${id} (${userEmail}) to ${tier}`);
            res.json(result.rows[0]);
        } catch (dbError: any) {
            console.error('Update tier DB error, trying fallback:', dbError.message);
            
            // Fallback to JSON
            try {
                const users = await getUsers();
                const index = users.findIndex((u: any) => String(u.id) === String(id));
                if (index !== -1) {
                    users[index].tier = tier;
                    saveToJSON(JSON_USERS_PATH, users);
                    await logAdminAction(req, (req as any).user, 'UPDATE_USER_TIER', `Updated tier for user ID ${id} (${userEmail}) to ${tier} (fallback)`);
                    return res.json(users[index]);
                }
                res.status(404).json({ error: 'User not found in JSON' });
            } catch (jsonError: any) {
                res.status(500).json({ error: jsonError.message });
            }
        }
    } catch (error: any) {
        console.error('Update tier error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Secure User Profile endpoint: Get user profile details
app.get('/api/users/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const authUser = (req as any).user;

        // Block regular users from fetching other users' profiles (only allow their own ID, unless they are admin)
        if (String(authUser.id) !== String(id) && authUser.role !== 'admin') {
            return res.status(403).json({ error: 'Forbidden. Access denied.' });
        }

        // 1. Try DB first
        try {
            const result = await query('SELECT id, name, email, role, tier, generations_used FROM users WHERE id = $1', [parseInt(id as string)]);
            if (result.rows.length > 0) {
                return res.json(result.rows[0]);
            }
        } catch (dbErr) {}

        // 2. Fallback to JSON
        const users = await getUsers();
        const found = users.find((u: any) => String(u.id) === String(id));
        if (found) {
            const { password_hash, session_token, ...safeUser } = found;
            return res.json(safeUser);
        }

        res.status(404).json({ error: 'User not found' });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// Memory endpoint: Get memory per user
app.get('/api/users/:id/memory', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = parseInt(id as string);

        let memory = { lastState: {}, history: [], behaviors: {} };
        
        try {
            const result = await query('SELECT last_state, history, behaviors FROM user_memories WHERE user_id = $1', [userId]);
            if (result.rows.length > 0) {
                memory = {
                    lastState: result.rows[0].last_state || {},
                    history: result.rows[0].history || [],
                    behaviors: result.rows[0].behaviors || {}
                };
                return res.json(memory);
            }
        } catch (dbErr: any) {
            console.warn('DB read memory failed, falling back to JSON:', dbErr.message);
        }

        // JSON fallback
        if (fs.existsSync(JSON_MEMORIES_PATH)) {
            try {
                const data = JSON.parse(fs.readFileSync(JSON_MEMORIES_PATH, 'utf8') || '{}');
                if (data[id as string]) {
                    memory = data[id as string];
                }
            } catch (parseErr) {
                console.warn('Failed to parse memories JSON:', parseErr);
            }
        }
        res.json(memory);
    } catch (e: any) {
        console.error('Error fetching user memory:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Memory endpoint: Save or append memory per user
app.post('/api/users/:id/memory', express.json(), async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = parseInt(id as string);
        const { lastState, historyItem, behaviorEvent } = req.body;

        // Fetch existing memory
        let currentMemory: any = { lastState: {}, history: [], behaviors: {} };
        let source = 'JSON';

        try {
            const result = await query('SELECT last_state, history, behaviors FROM user_memories WHERE user_id = $1', [userId]);
            if (result.rows.length > 0) {
                currentMemory = {
                    lastState: result.rows[0].last_state || {},
                    history: result.rows[0].history || [],
                    behaviors: result.rows[0].behaviors || {}
                };
                source = 'DB';
            }
        } catch (dbErr) {}

        if (source === 'JSON' && fs.existsSync(JSON_MEMORIES_PATH)) {
            const data = JSON.parse(fs.readFileSync(JSON_MEMORIES_PATH, 'utf8') || '{}');
            if (data[id as string]) {
                currentMemory = data[id as string];
            }
        }

        // Apply updates
        if (lastState) {
            currentMemory.lastState = { ...currentMemory.lastState, ...lastState };
        }
        if (historyItem) {
            currentMemory.history = [historyItem, ...(currentMemory.history || [])].slice(0, 100);
        }
        if (behaviorEvent) {
            const eventType = behaviorEvent.type || 'unknown';
            const timestamp = behaviorEvent.timestamp || new Date().toISOString();
            
            if (!currentMemory.behaviors) currentMemory.behaviors = {};
            if (!currentMemory.behaviors.events) currentMemory.behaviors.events = [];
            currentMemory.behaviors.events = [{ type: eventType, timestamp, details: behaviorEvent.details || {} }, ...(currentMemory.behaviors.events || [])].slice(0, 150);
            
            // Increment counts
            if (!currentMemory.behaviors.counts) currentMemory.behaviors.counts = {};
            currentMemory.behaviors.counts[eventType] = (currentMemory.behaviors.counts[eventType] || 0) + 1;
            currentMemory.behaviors.lastActive = timestamp;
        }

        // Save back to DB
        try {
            if (source === 'DB') {
                await query(`
                    UPDATE user_memories
                    SET last_state = $1, history = $2, behaviors = $3, updated_at = CURRENT_TIMESTAMP
                    WHERE user_id = $4
                `, [JSON.stringify(currentMemory.lastState), JSON.stringify(currentMemory.history), JSON.stringify(currentMemory.behaviors), userId]);
            } else {
                await query(`
                    INSERT INTO user_memories (user_id, last_state, history, behaviors, updated_at)
                    VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
                `, [userId, JSON.stringify(currentMemory.lastState), JSON.stringify(currentMemory.history), JSON.stringify(currentMemory.behaviors)]);
            }
        } catch (dbErr: any) {
            console.warn('DB save memory failed, writing to JSON fallback:', dbErr.message);
        }

        // Always save to JSON fallback
        let data: any = {};
        if (fs.existsSync(JSON_MEMORIES_PATH)) {
            try {
                data = JSON.parse(fs.readFileSync(JSON_MEMORIES_PATH, 'utf8') || '{}');
            } catch (parseErr) {
                console.warn('Failed to parse memories JSON during save:', parseErr);
            }
        }
        data[id as string] = currentMemory;
        fs.writeFileSync(JSON_MEMORIES_PATH, JSON.stringify(data, null, 2), 'utf8');

        res.json({ success: true, memory: currentMemory });
    } catch (e: any) {
        console.error('Error saving user memory:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Admin endpoint: Get rich user detail including profile and memory
app.get('/api/admin/users/:id/detail', requireAdmin, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = parseInt(id as string);

        let userProfile: any = null;
        
        // 1. Get user profile
        try {
            const result = await query('SELECT id, name, email, phone, address, role, tier, generations_used, created_at FROM users WHERE id = $1', [userId]);
            if (result.rows.length > 0) {
                userProfile = result.rows[0];
            }
        } catch (e) {}

        if (!userProfile) {
            const users = await getUsers();
            userProfile = users.find((u: any) => String(u.id) === String(id));
        }

        if (!userProfile) {
            return res.status(404).json({ error: 'User not found' });
        }

        // 2. Get memory
        let memory = { lastState: {}, history: [], behaviors: {} };
        try {
            const result = await query('SELECT last_state, history, behaviors FROM user_memories WHERE user_id = $1', [userId]);
            if (result.rows.length > 0) {
                memory = {
                    lastState: result.rows[0].last_state || {},
                    history: result.rows[0].history || [],
                    behaviors: result.rows[0].behaviors || {}
                };
            } else {
                // Check JSON fallback
                if (fs.existsSync(JSON_MEMORIES_PATH)) {
                    const data = JSON.parse(fs.readFileSync(JSON_MEMORIES_PATH, 'utf8') || '{}');
                    if (data[id as string]) memory = data[id as string];
                }
            }
        } catch (e) {
            if (fs.existsSync(JSON_MEMORIES_PATH)) {
                try {
                    const data = JSON.parse(fs.readFileSync(JSON_MEMORIES_PATH, 'utf8') || '{}');
                    if (data[id as string]) memory = data[id as string];
                } catch (parseErr) {}
            }
        }

        res.json({
            ...userProfile,
            memory
        });
    } catch (e: any) {
        console.error('Error fetching admin user detail:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Account Deletion Endpoint (App Store & Play Store compliance)
app.delete('/api/users/:id/delete-account', requireAuth, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = parseInt(id as string);
        const requestingUser = (req as any).user;

        if (String(requestingUser.id) !== String(id) && requestingUser.role !== 'admin') {
            return res.status(403).json({ error: 'Forbidden. You do not have permission to delete this account.' });
        }

        // Get user email for audit log
        let userEmail = 'unknown';
        try {
            const uResult = await query('SELECT email FROM users WHERE id = $1', [userId]);
            if (uResult.rows.length > 0) userEmail = uResult.rows[0].email;
        } catch (e) {}
        if (userEmail === 'unknown') {
            try {
                const fallbackUsers = await getUsers();
                const foundU = fallbackUsers.find((u: any) => String(u.id) === String(id));
                if (foundU) userEmail = foundU.email;
            } catch (e) {}
        }

        // Delete from database
        try {
            await query('DELETE FROM user_memories WHERE user_id = $1', [userId]);
            await query('DELETE FROM users WHERE id = $1', [userId]);
        } catch (dbErr: any) {
            console.warn('DB delete account failed, trying JSON fallback:', dbErr.message);
        }

        // Delete from JSON fallback
        if (fs.existsSync(JSON_USERS_PATH)) {
            let users = await getUsers();
            users = users.filter((u: any) => String(u.id) !== String(id));
            saveToJSON(JSON_USERS_PATH, users);
        }

        if (fs.existsSync(JSON_MEMORIES_PATH)) {
            const data = JSON.parse(fs.readFileSync(JSON_MEMORIES_PATH, 'utf8') || '{}');
            if (data[id as string]) {
                delete data[id as string];
                fs.writeFileSync(JSON_MEMORIES_PATH, JSON.stringify(data, null, 2), 'utf8');
            }
        }

        // Log the action!
        await logAdminAction(
            req, 
            requestingUser.role === 'admin' ? requestingUser : { name: 'User Self', email: userEmail, session_token: requestingUser.session_token }, 
            'DELETE_USER', 
            `Deleted user account ID ${id} (${userEmail})`
        );

        res.json({ success: true, message: 'Account and associated data deleted successfully.' });
    } catch (e: any) {
        console.error('Error deleting account:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create Admin User (Admin only)
app.post('/api/admin/users/create-admin', requireAdmin, async (req: Request, res: Response) => {
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
            
            await logAdminAction(req, (req as any).user, 'CREATE_ADMIN', `Created new admin user: ${name} (${email})`);
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
            
            await logAdminAction(req, (req as any).user, 'CREATE_ADMIN', `Created new admin user (fallback): ${name} (${email})`);
            const { password_hash, ...response } = newAdmin;
            res.status(201).json(response);
        }
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Get all users (Admin only)
app.get('/api/admin/users', requireAdmin, async (req: Request, res: Response) => {
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
        
        const tiers = await getTiers();
        const tierConfig = tiers[tierKey as keyof TiersConfig] || tiers.FREE;

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
            const tiers = await getTiers();
            const tierConfig = tiers[tier.toUpperCase() as keyof TiersConfig] || tiers.FREE;
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
            port: PORT,
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

    // Dispatch error alert to Telegram
    try {
        const errorObj = new Error(typeof error === 'string' ? error : (error?.message || JSON.stringify(error)));
        telegramAlerts.sendErrorAlert(
            errorObj,
            `Frontend Error (User ID: ${userId || 'Guest'})\nContext: ${context || 'N/A'}`
        );
    } catch (tgErr) {
        console.error('Failed to send frontend error to Telegram:', tgErr);
    }

    res.json({ status: 'logged' });
});

app.get('/api/debug/errors', (req: Request, res: Response) => {
    res.json(errorLog.slice(0, 10));
});

// DEPRECATED: Use /api/ai/generate-overlay instead. This endpoint is a legacy stub.
app.post('/api/ai/generate', async (req: Request, res: Response) => {
    res.json({ 
        success: false, 
        error: 'This endpoint is deprecated. Please use /api/ai/generate-overlay instead.',
        deprecated: true
    });
});

// Admin Config Endpoints
app.get('/api/admin/config', requireAdmin, async (req: Request, res: Response) => {
    const config = await getConfig();
    res.json({ 
        aiProvider: config.AI_PROVIDER || 'gemini',
        hasKey: !!config.GEMINI_API_KEY,
        hasOpenAIKey: !!config.OPENAI_API_KEY,
        hasStripeSecretKey: !!config.STRIPE_SECRET_KEY,
        hasStripeWebhookSecret: !!config.STRIPE_WEBHOOK_SECRET
    });
});

// Admin Security Audit Logs Endpoint
app.get('/api/admin/audit-logs', requireAdmin, async (req: Request, res: Response) => {
    try {
        let logs: any[] = [];
        if (fs.existsSync(JSON_AUDIT_LOGS_PATH)) {
            try {
                const content = fs.readFileSync(JSON_AUDIT_LOGS_PATH, 'utf8');
                logs = JSON.parse(content || '[]');
            } catch (err) {
                logs = [];
            }
        }
        res.json(logs);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
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
        aiProvider: config.AI_PROVIDER || 'gemini',
        keyPresent: !!config.GEMINI_API_KEY,
        keyLength: config.GEMINI_API_KEY?.length || 0,
        openaiKeyPresent: !!config.OPENAI_API_KEY,
        envKeyPresent: !!(process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY),
    });
});

app.post('/api/admin/config', requireAdmin, async (req: Request, res: Response) => {
    try {
        const { apiKey, openaiApiKey, aiProvider, stripeSecretKey, stripeWebhookSecret } = req.body;
        
        const config = await getConfig();
        if (apiKey !== undefined) config.GEMINI_API_KEY = apiKey;
        if (openaiApiKey !== undefined) config.OPENAI_API_KEY = openaiApiKey;
        if (aiProvider !== undefined) config.AI_PROVIDER = aiProvider;
        if (stripeSecretKey !== undefined) config.STRIPE_SECRET_KEY = stripeSecretKey;
        if (stripeWebhookSecret !== undefined) config.STRIPE_WEBHOOK_SECRET = stripeWebhookSecret;
        
        saveToJSON(JSON_CONFIG_PATH, config);
        
        await logAdminAction(req, (req as any).user, 'UPDATE_CONFIG', `Updated AI provider (${config.AI_PROVIDER}) and server credentials`);
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// Dynamic Tiers Endpoints
app.get('/api/tiers', async (req: Request, res: Response) => {
    try {
        const tiers = await getTiers();
        res.json(tiers);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/tiers', requireAdmin, express.json(), async (req: Request, res: Response) => {
    try {
        const config = req.body;
        if (!config || !config.FREE) {
            return res.status(400).json({ error: 'Invalid tiers configuration structure' });
        }
        await saveTiers(config);
        await logAdminAction(req, (req as any).user, 'UPDATE_TIERS_CONFIG', 'Updated pricing tiers, limits, and Stripe IDs configuration');
        res.json({ success: true, config });
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

        // Only allow Google Drive / Google User Content domains
        const allowedProxyDomains = ['lh3.googleusercontent.com', 'drive.google.com', 'drive.usercontent.google.com'];
        let parsedUrl: URL;
        try {
            parsedUrl = new URL(url);
        } catch {
            return res.status(400).json({ error: 'Invalid URL' });
        }
        if (!allowedProxyDomains.includes(parsedUrl.hostname)) {
            return res.status(403).json({ error: 'Domain not allowed' });
        }

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
        const contentLength = imageRes.headers.get('content-length');
        if (contentLength && parseInt(contentLength) > 5 * 1024 * 1024) {
            return res.status(413).json({ error: 'Image too large. Max 5MB.' });
        }

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

// Serve product images from /products/
const productsPath = path.join(path.resolve(), 'products');
if (!fs.existsSync(productsPath)) {
    fs.mkdirSync(productsPath, { recursive: true });
}
app.use('/products', express.static(productsPath));

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

    // If the request is for a static asset that does not exist, return a clean 404
    // (ends with an extension or resides in /assets/ folder)
    const hasExtension = path.extname(req.path) !== '';
    if (hasExtension || req.path.startsWith('/assets/')) {
        res.status(404).send('Asset not found');
        return;
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
    
    // Startup notifications disabled as per user request
    
    // Periodic reports disabled as per user request
});

} catch (startupError) {
    logCrash(startupError);
    process.exit(1);
}
