import crypto from 'crypto';
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

    try {
        const result = await query(
            'SELECT id, name, email, phone, address, role, tier, generations_used, session_token FROM users WHERE session_token = $1',
            [token]
        );
        if (result.rows.length > 0) return result.rows[0] as User;
    } catch (dbErr) {
        // DB down fall through to JSON
    }

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
            const token = 'boot_' + crypto.randomBytes(32).toString('hex');
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
