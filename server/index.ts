// ConstructViz AI - Express Backend Server
// Handles materials database and purchase requests

import express, { Request, Response } from 'express';
import cors from 'cors';
import pg from 'pg';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { sendPurchaseNotifications } from './emailService';

// CRASH LOGGER: Captures startup errors on Hostinger
function logCrash(error: any) {
    const msg = `${new Date().toISOString()}\n${error.stack || error}\n`;
    try {
        fs.appendFileSync(path.join(process.cwd(), 'crash.log'), msg);
    } catch (e) {}
    console.error('CRITICAL STARTUP ERROR:', error);
}

try {
const { Pool } = pg;
const app = express();
const PORT = process.env.PORT || 3000;

// Database Configuration (Support both URL and individual vars)
const dbConfig = process.env.DATABASE_URL 
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: Number(process.env.DB_PORT) || 5432
    };

const pool = new Pool({
    ...dbConfig,
    ssl: { rejectUnauthorized: false }
});

// In-memory error log for debugging
const errorLog: any[] = [];

const TIERS = {
    FREE: { name: 'Free', limit: 5 },
    PRO: { name: 'Pro', limit: 50 },
    ENTERPRISE: { name: 'Enterprise', limit: 9999 }
};

// Run migrations on startup
async function runMigrations() {
    try {
        await pool.query(`
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

const JSON_CONFIG_PATH = path.join(process.cwd(), 'data', 'config.json');

// Helper to get config (API Keys, etc.)
async function getConfig() {
    try {
        if (fs.existsSync(JSON_CONFIG_PATH)) {
            return JSON.parse(fs.readFileSync(JSON_CONFIG_PATH, 'utf8'));
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
        const result = await pool.query('SELECT * FROM materials ORDER BY created_at DESC');
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
        const result = await pool.query('SELECT * FROM users');
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

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Health check
app.get('/api/health', (req: Request, res: Response) => {
    res.json({ 
        status: 'ok', 
        database: 'fallback_enabled',
        timestamp: new Date().toISOString() 
    });
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
            const result = await pool.query(
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

        const result = await pool.query(
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
        console.error('Update material error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete material
app.delete('/api/materials/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        try {
            const result = await pool.query('DELETE FROM materials WHERE id = $1 RETURNING id', [id]);
            if (result.rows.length === 0) {
                // If not in DB, maybe it's in JSON
                throw new Error('Not found in DB');
            }
            res.json({ success: true, id: result.rows[0].id });
        } catch (dbError) {
            console.warn('DB delete failed or not found, checking JSON fallback...');
            const materials = await getMaterials();
            const initialLength = materials.length;
            const filtered = materials.filter((m: any) => m.id !== id && String(m.id) !== id);
            
            if (filtered.length === initialLength) {
                return res.status(404).json({ error: 'Material not found in fallback' });
            }
            
            saveToJSON(JSON_DB_PATH, filtered);
            res.json({ success: true, id });
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
            await pool.query(
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
        await pool.query('DELETE FROM materials');
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
        const result = await pool.query(
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
                await pool.query(
                    `INSERT INTO email_logs (purchase_request_id, recipient_email, email_type, status)
           VALUES ($1, $2, $3, $4)`,
                    [purchaseRequest.id, customer_email, 'customer_confirmation', 'sent']
                );
            }

            if (notifications.admin.success) {
                await pool.query(
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

        const result = await pool.query(
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

        const result = await pool.query(query, params);

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
        const result = await pool.query('SELECT * FROM purchase_requests WHERE id = $1', [id]);

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

        const result = await pool.query(
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
            const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
            if (existing.rows.length > 0) {
                return res.status(400).json({ error: 'Email already registered' });
            }

            // Hash password before saving
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);

            const result = await pool.query(
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
            const result = await pool.query(
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
        const result = await pool.query('SELECT * FROM materials ORDER BY category, name');
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
        const result = await pool.query(
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
        const all = await pool.query('SELECT * FROM materials ORDER BY category, name');
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
         const result = await pool.query(
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
         const all = await pool.query('SELECT * FROM materials ORDER BY category, name');
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

// Delete material
app.delete('/api/materials/:id', async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM materials WHERE id = $1 OR ref_code = $2', [id, id]);
        
        // Sync to JSON fallback
        const all = await pool.query('SELECT * FROM materials ORDER BY category, name');
        fs.writeFileSync(JSON_DB_PATH, JSON.stringify(all.rows, null, 2));
        
        res.json({ success: true });
    } catch (error: any) {
        console.warn('DB delete failed, updating JSON directly:', error.message);
        
        try {
            if (fs.existsSync(JSON_DB_PATH)) {
                const data = JSON.parse(fs.readFileSync(JSON_DB_PATH, 'utf8'));
                const filtered = data.filter((item: any) => 
                    String(item.id) !== String(id) && 
                    String(item.refCode || item.ref_code) !== String(id)
                );
                
                if (data.length === filtered.length) {
                    return res.status(404).json({ error: 'Material not found in JSON' });
                }
                
                fs.writeFileSync(JSON_DB_PATH, JSON.stringify(filtered, null, 2));
                return res.json({ success: true, note: 'Deleted from JSON fallback only' });
            }
            res.status(500).json({ error: 'DB down and JSON file missing' });
        } catch (jsonError: any) {
            res.status(500).json({ error: 'Failed to delete from JSON: ' + jsonError.message });
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

        const result = await pool.query(
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
            const result = await pool.query(
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
        const result = await pool.query('SELECT id, name, email, role, tier, generations_used, created_at FROM users ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (error: any) {
        console.error('Get users error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== AI GENERATION PROXY (Quota Enforced) =====

async function checkAndIncrementQuota(userId: number): Promise<{ allowed: boolean; limit?: number; used?: number; error?: string }> {
    try {
        // Special case for Super Admin
        if (userId === 999) return { allowed: true };

        const result = await pool.query('SELECT tier, generations_used FROM users WHERE id = $1', [userId]);
        if (result.rows.length === 0) return { allowed: false, error: 'User not found' };

        const { tier, generations_used } = result.rows[0];
        const tierConfig = TIERS[tier.toUpperCase() as keyof typeof TIERS] || TIERS.FREE;

        if (generations_used >= tierConfig.limit) {
            return { allowed: false, limit: tierConfig.limit, used: generations_used };
        }

        await pool.query('UPDATE users SET generations_used = generations_used + 1 WHERE id = $1', [userId]);
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
        await pool.query('SELECT 1');
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
const __dirname = path.resolve();
const distPath = fs.existsSync(path.join(__dirname, 'dist')) 
    ? path.join(__dirname, 'dist') 
    : __dirname;

console.log(`📂 Serving static files from: ${distPath}`);

app.use(express.static(distPath));

// SPA fallback: handle all non-API routes
app.get('*', (req: Request, res: Response, next) => {
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
app.listen(PORT, () => {
    console.log(`🚀 ConstructViz AI Server running on port ${PORT}`);
    console.log(`📊 Serving from: ${distPath}`);
});

} catch (startupError) {
    logCrash(startupError);
    process.exit(1);
}
