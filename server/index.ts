import express from 'express';
import cors from 'cors';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const distPath = path.join(__dirname, '..', 'dist');
const isProduction = fs.existsSync(distPath);
const PORT = isProduction ? 5000 : 3001;

app.use(cors());
app.use(express.json());

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

app.get('/api/settings/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const result = await pool.query(
      'SELECT setting_value FROM app_settings WHERE setting_key = $1',
      [key]
    );
    if (result.rows.length > 0) {
      res.json({ value: result.rows[0].setting_value });
    } else {
      res.json({ value: null });
    }
  } catch (error) {
    console.error('Error fetching setting:', error);
    res.status(500).json({ error: 'Failed to fetch setting' });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const { key, value } = req.body;
    await pool.query(
      `INSERT INTO app_settings (setting_key, setting_value, updated_at) 
       VALUES ($1, $2, CURRENT_TIMESTAMP) 
       ON CONFLICT (setting_key) 
       DO UPDATE SET setting_value = $2, updated_at = CURRENT_TIMESTAMP`,
      [key, value]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving setting:', error);
    res.status(500).json({ error: 'Failed to save setting' });
  }
});

app.delete('/api/settings/:key', async (req, res) => {
  try {
    const { key } = req.params;
    await pool.query('DELETE FROM app_settings WHERE setting_key = $1', [key]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting setting:', error);
    res.status(500).json({ error: 'Failed to delete setting' });
  }
});

if (isProduction) {
  app.use(express.static(distPath));
  
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      return res.sendFile(path.join(distPath, 'index.html'));
    }
    next();
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}${isProduction ? ' (production)' : ' (development)'}`);
});
