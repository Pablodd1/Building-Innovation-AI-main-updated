import pg from 'pg';
import bcrypt from 'bcryptjs';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/constructviz_db'
});

async function setup() {
    try {
        // Create tables if they don't exist
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                phone VARCHAR(50),
                address TEXT,
                password_hash TEXT NOT NULL,
                role VARCHAR(20) DEFAULT 'customer',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE TABLE IF NOT EXISTS materials (
                id SERIAL PRIMARY KEY,
                ref_code VARCHAR(100) UNIQUE NOT NULL,
                name VARCHAR(255) NOT NULL,
                category VARCHAR(100) NOT NULL,
                subcategory VARCHAR(100),
                price DECIMAL(12, 2) NOT NULL,
                currency VARCHAR(10) DEFAULT 'USD',
                unit VARCHAR(50),
                items_per_box INTEGER DEFAULT 1,
                width_cm DECIMAL(10, 2),
                length_cm DECIMAL(10, 2),
                thickness_m DECIMAL(10, 2),
                description TEXT,
                image_url TEXT,
                usage VARCHAR(50),
                prompt_modifier TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Hash admin password
        const salt = await bcrypt.genSalt(10);
        const adminHash = await bcrypt.hash('admin@@@1', salt);

        // Insert Admin User
        await pool.query(`
            INSERT INTO users (name, email, password_hash, role)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (email) DO UPDATE SET password_hash = $3, role = $4;
        `, ['Admin', 'admin@gmail.com', adminHash, 'admin']);
        console.log('✅ Admin user and tables set up successfully');
    } catch (err) {
        console.error('❌ Setup failed:', err);
    } finally {
        await pool.end();
    }
}

setup();
