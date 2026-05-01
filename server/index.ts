// ConstructViz AI - Express Backend Server
// Handles materials database and purchase requests

import express, { Request, Response } from 'express';
import cors from 'cors';
import pg from 'pg';
import path from 'path';
import fs from 'fs';
import { sendPurchaseNotifications } from './emailService';

const { Pool } = pg;
const app = express();
const PORT = process.env.PORT || 3000;

// Database connection with fallback to local JSON
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/constructviz_db',
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const JSON_DB_PATH = path.join(process.cwd(), 'public', 'data', 'products.json');

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
            ref_code, name, category, subcategory, price, currency, unit,
            items_per_box, width_cm, length_cm, thickness_m,
            description, image_url, usage, prompt_modifier
        } = req.body;

        const result = await pool.query(
            `INSERT INTO materials (
        ref_code, name, category, subcategory, price, currency, unit,
        items_per_box, width_cm, length_cm, thickness_m,
        description, image_url, usage, prompt_modifier
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *`,
            [ref_code, name, category, subcategory, price, currency || 'USD', unit,
                items_per_box || 1, width_cm, length_cm, thickness_m,
                description, image_url, usage, prompt_modifier]
        );

        res.status(201).json(result.rows[0]);
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
        const result = await pool.query('DELETE FROM materials WHERE id = $1 RETURNING id', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Material not found' });
        }

        res.json({ success: true, id: result.rows[0].id });
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

// Simple user signup (production would use bcrypt for password hashing)
app.post('/api/auth/signup', async (req: Request, res: Response) => {
    try {
        const { name, email, phone, address, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email, and password required' });
        }

        // Check if email already exists
        const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        // In production, use bcrypt.hash(password, 10)
        const result = await pool.query(
            `INSERT INTO users (name, email, phone, address, password_hash, role)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, email, phone, address, role, created_at`,
            [name, email, phone || null, address || null, password, 'customer']
        );

        res.status(201).json({ user: result.rows[0] });
    } catch (error: any) {
        console.error('Signup error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Simple user login
app.post('/api/auth/login', async (req: Request, res: Response) => {
    // Hoist so they're accessible in catch block
    const email: string = req.body?.email || '';
    const password: string = req.body?.password || '';
    try {
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        // Hardcoded admin fallback — always works regardless of DB
        if (email === 'admin@gmail.com' && password === 'admin@@@1') {
            return res.json({ 
                user: { 
                    id: 999, 
                    name: 'Super Admin', 
                    email: 'admin@gmail.com', 
                    role: 'admin' 
                } 
            });
        }

        const result = await pool.query(
            'SELECT id, name, email, phone, address, role, password_hash FROM users WHERE email = $1',
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = result.rows[0];

        if (password !== user.password_hash) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const { password_hash, ...userData } = user;
        res.json({ user: userData });
    } catch (error: any) {
        console.error('Login error:', error);
        // Even on DB error, admin fallback still works
        if (email === 'admin@gmail.com' && password === 'admin@@@1') {
             return res.json({ 
                user: { id: 999, name: 'Super Admin', email: 'admin@gmail.com', role: 'admin' } 
            });
        }
        res.status(500).json({ error: error.message });
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
const distPath = path.join(__dirname, 'dist');

if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    // SPA fallback: redirect all non-API requests to index.html
    app.get('*', (req: Request, res: Response) => {
        if (!req.path.startsWith('/api')) {
            res.sendFile(path.join(distPath, 'index.html'));
        }
    });
}

// Start server
app.listen(PORT, () => {
    console.log(`🚀 ConstructViz AI Server running on port ${PORT}`);
    console.log(`📊 Database: ${process.env.DATABASE_URL?.split('@')[1] || 'localhost'}`);
    console.log(`📧 Email service: ${process.env.RESEND_API_KEY ? '✓ Configured' : '✗ Not configured'}`);
});
