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

app.get('/api/materials', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM materials ORDER BY id');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching materials:', error);
    res.status(500).json({ error: 'Failed to fetch materials' });
  }
});

app.post('/api/materials', async (req, res) => {
  try {
    const { ref_code, name, category, subcategory, price, unit, items_per_box, width_cm, length_cm, thickness_m, description, image_url, usage, prompt_modifier } = req.body;
    const result = await pool.query(
      `INSERT INTO materials (ref_code, name, category, subcategory, price, unit, items_per_box, width_cm, length_cm, thickness_m, description, image_url, usage, prompt_modifier, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)
       RETURNING *`,
      [ref_code, name, category, subcategory, price || 0, unit || 'Piece', items_per_box || 1, width_cm || 0, length_cm || 0, thickness_m || 0, description, image_url, usage || 'Interior', prompt_modifier]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating material:', error);
    res.status(500).json({ error: 'Failed to create material' });
  }
});

app.post('/api/materials/bulk', async (req, res) => {
  try {
    const { materials } = req.body;
    if (!materials || !Array.isArray(materials)) {
      return res.status(400).json({ error: 'Materials array required' });
    }
    
    let imported = 0;
    for (const mat of materials) {
      await pool.query(
        `INSERT INTO materials (ref_code, name, category, subcategory, price, unit, items_per_box, width_cm, length_cm, thickness_m, description, image_url, usage, prompt_modifier, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)`,
        [mat.ref_code, mat.name, mat.category, mat.subcategory, mat.price || 0, mat.unit || 'Piece', mat.items_per_box || 1, mat.width_cm || 0, mat.length_cm || 0, mat.thickness_m || 0, mat.description, mat.image_url, mat.usage || 'Interior', mat.prompt_modifier]
      );
      imported++;
    }
    res.json({ success: true, imported });
  } catch (error) {
    console.error('Error bulk importing materials:', error);
    res.status(500).json({ error: 'Failed to import materials' });
  }
});

app.put('/api/materials/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { ref_code, name, category, subcategory, price, unit, items_per_box, width_cm, length_cm, thickness_m, description, image_url, usage, prompt_modifier } = req.body;
    const result = await pool.query(
      `UPDATE materials SET ref_code=$1, name=$2, category=$3, subcategory=$4, price=$5, unit=$6, items_per_box=$7, width_cm=$8, length_cm=$9, thickness_m=$10, description=$11, image_url=$12, usage=$13, prompt_modifier=$14, updated_at=CURRENT_TIMESTAMP
       WHERE id=$15 RETURNING *`,
      [ref_code, name, category, subcategory, price, unit, items_per_box, width_cm, length_cm, thickness_m, description, image_url, usage, prompt_modifier, id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating material:', error);
    res.status(500).json({ error: 'Failed to update material' });
  }
});

app.delete('/api/materials/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM materials WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting material:', error);
    res.status(500).json({ error: 'Failed to delete material' });
  }
});

app.delete('/api/materials', async (req, res) => {
  try {
    await pool.query('DELETE FROM materials');
    res.json({ success: true });
  } catch (error) {
    console.error('Error clearing materials:', error);
    res.status(500).json({ error: 'Failed to clear materials' });
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
