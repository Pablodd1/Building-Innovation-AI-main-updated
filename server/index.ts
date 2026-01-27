import express from "express";
import cors from "cors";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const distPath = path.join(__dirname, "..", "dist");
const isProduction = fs.existsSync(distPath);
const PORT = isProduction ? 5000 : 3001;

app.use(cors());
app.use(express.json({ limit: "50mb" }));

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

// Mock Storage for Development Fallback
let useMock = false;
let mockSettings: Record<string, string> = {};

// Default Materials Seed Data
const DEFAULT_MATERIALS = [
  {
    id: 1,
    ref_code: "WAL-MAR-GRY",
    name: "Pared Mármol Gris",
    description:
      "Self-adhesive grey marble wall covering with classic white stone veining.",
    image_url:
      "https://images.unsplash.com/photo-1615800098779-1be32e60cca3?auto=format&fit=crop&w=800&q=80",
    prompt_modifier:
      "grey marble wall covering, continuous seamless stone texture, high gloss finish",
    category: "Rollos Adhesivos",
    subcategory: "Mármol",
    usage: "Interior",
    width_cm: 120,
    length_cm: 300,
    thickness_m: 2,
    price: 85.0,
    unit: "Roll",
    items_per_box: 1,
  },
  {
    id: 2,
    ref_code: "SPC-OAK-LGT",
    name: "Roble Claro SPC",
    description:
      "Light Oak SPC Flooring (Rigid Core). Water resistant and durable wood-look planks.",
    image_url:
      "https://images.unsplash.com/photo-1589578228447-e1a4e481c6c8?auto=format&fit=crop&w=800&q=80",
    prompt_modifier: "light oak spc flooring planks, clean modern wood floor",
    category: "Pisos SPC",
    subcategory: "Madera",
    usage: "Interior",
    width_cm: 18.3,
    length_cm: 122,
    thickness_m: 0.4,
    price: 35.0,
    unit: "Box",
    items_per_box: 10,
  },
];

let mockMaterials: any[] = [...DEFAULT_MATERIALS];

// Initialize database tables
async function initDatabase() {
  try {
    // Attempt a simple query to check connection
    await pool.query("SELECT NOW()");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        id SERIAL PRIMARY KEY,
        setting_key VARCHAR(255) UNIQUE NOT NULL,
        setting_value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS materials (
        id SERIAL PRIMARY KEY,
        ref_code VARCHAR(100) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(100),
        subcategory VARCHAR(100),
        price DECIMAL(10,2) DEFAULT 0,
        unit VARCHAR(50) DEFAULT 'Piece',
        items_per_box INTEGER DEFAULT 1,
        width_cm DECIMAL(10,2) DEFAULT 0,
        length_cm DECIMAL(10,2) DEFAULT 0,
        thickness_m DECIMAL(10,4) DEFAULT 0,
        description TEXT,
        image_url TEXT,
        usage VARCHAR(50) DEFAULT 'Interior',
        prompt_modifier TEXT,
        currency VARCHAR(10) DEFAULT 'USD',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create default admin user if not exists
    const adminExists = await pool.query("SELECT id FROM users WHERE email = 'admin@gmail.com'");
    if (adminExists.rows.length === 0) {
      await pool.query(
        "INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4)",
        ["Admin", "admin@gmail.com", "admin@@@1", "admin"]
      );
      console.log("✅ Default admin user created");
    }

    console.log("✅ Database tables initialized");
  } catch (error) {
    console.warn(
      "⚠️ Postgres connection failed. Switching to IN-MEMORY MOCK MODE for development.",
    );
    useMock = true;
  }
}

initDatabase();

// Image proxy endpoint for CORS-blocked images
app.get("/api/image-proxy", async (req, res) => {
  const imageUrl = req.query.url as string;
  if (!imageUrl) {
    return res.status(400).json({ error: "URL parameter required" });
  }
  
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      return res.status(response.status).json({ error: "Failed to fetch image" });
    }
    
    const contentType = response.headers.get("content-type") || "image/jpeg";
    const buffer = await response.arrayBuffer();
    
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error("Image proxy error:", error);
    res.status(500).json({ error: "Failed to proxy image" });
  }
});

// Health check endpoint
app.get("/api/health", async (req, res) => {
  if (useMock) {
    return res.json({
      status: "ok",
      database: "mock_mode_active",
      materialsCount: mockMaterials.length,
    });
  }
  try {
    const result = await pool.query("SELECT COUNT(*) as count FROM materials");
    res.json({
      status: "ok",
      database: "connected",
      materialsCount: parseInt(result.rows[0].count),
    });
  } catch (error) {
    console.error("Health check failed:", error);
    res
      .status(500)
      .json({
        status: "error",
        database: "disconnected",
        error: String(error),
      });
  }
});

// Authentication endpoints
app.post("/api/auth/signup", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: "Name, email, and password are required" });
  }
  if (useMock) {
    return res.status(500).json({ error: "Database not available" });
  }
  try {
    // Check if email already exists
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: "Email already registered" });
    }
    // Create new user
    const result = await pool.query(
      "INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role",
      [name, email, password, "user"]
    );
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({ error: "Failed to create account" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }
  if (useMock) {
    return res.status(500).json({ error: "Database not available" });
  }
  try {
    const result = await pool.query(
      "SELECT id, name, email, role FROM users WHERE email = $1 AND password = $2",
      [email, password]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

app.get("/api/settings/:key", async (req, res) => {
  const { key } = req.params;
  if (useMock) {
    return res.json({ value: mockSettings[key] || null });
  }
  try {
    const result = await pool.query(
      "SELECT setting_value FROM app_settings WHERE setting_key = $1",
      [key],
    );
    res.json({
      value: result.rows.length > 0 ? result.rows[0].setting_value : null,
    });
  } catch (error) {
    console.error("Error fetching setting:", error);
    res.status(500).json({ error: "Failed to fetch setting" });
  }
});

app.post("/api/settings", async (req, res) => {
  const { key, value } = req.body;
  if (useMock) {
    mockSettings[key] = value;
    return res.json({ success: true });
  }
  try {
    await pool.query(
      `INSERT INTO app_settings (setting_key, setting_value, updated_at) 
       VALUES ($1, $2, CURRENT_TIMESTAMP) 
       ON CONFLICT (setting_key) 
       DO UPDATE SET setting_value = $2, updated_at = CURRENT_TIMESTAMP`,
      [key, value],
    );
    res.json({ success: true });
  } catch (error) {
    console.error("Error saving setting:", error);
    res.status(500).json({ error: "Failed to save setting" });
  }
});

app.delete("/api/settings/:key", async (req, res) => {
  const { key } = req.params;
  if (useMock) {
    delete mockSettings[key];
    return res.json({ success: true });
  }
  try {
    await pool.query("DELETE FROM app_settings WHERE setting_key = $1", [key]);
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting setting:", error);
    res.status(500).json({ error: "Failed to delete setting" });
  }
});

app.get("/api/materials", async (req, res) => {
  if (useMock) {
    return res.json(mockMaterials);
  }
  try {
    const result = await pool.query("SELECT * FROM materials ORDER BY id");
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching materials:", error);
    res.status(500).json({ error: "Failed to fetch materials" });
  }
});

app.post("/api/materials", async (req, res) => {
  const {
    ref_code,
    name,
    category,
    subcategory,
    price,
    currency,
    unit,
    items_per_box,
    width_cm,
    length_cm,
    thickness_m,
    description,
    image_url,
    usage,
    prompt_modifier,
  } = req.body;

  if (useMock) {
    const newMat = {
      id:
        mockMaterials.length > 0
          ? Math.max(...mockMaterials.map((m) => m.id)) + 1
          : 1,
      ref_code,
      name,
      category,
      subcategory,
      price: price || 0,
      unit: unit || "Piece",
      items_per_box: items_per_box || 1,
      currency: currency || "USD",
      width_cm: width_cm || 0,
      length_cm: length_cm || 0,
      thickness_m: thickness_m || 0,
      description,
      image_url,
      usage: usage || "Interior",
      prompt_modifier,
      updated_at: new Date().toISOString(),
    };
    mockMaterials.push(newMat);
    return res.json(newMat);
  }

  try {
    const result = await pool.query(
      `INSERT INTO materials (ref_code, name, category, subcategory, price, currency, unit, items_per_box, width_cm, length_cm, thickness_m, description, image_url, usage, prompt_modifier, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP)
       RETURNING *`,
      [
        ref_code,
        name,
        category,
        subcategory,
        price || 0,
        currency || "USD",
        unit || "Piece",
        items_per_box || 1,
        width_cm || 0,
        length_cm || 0,
        thickness_m || 0,
        description,
        image_url,
        usage || "Interior",
        prompt_modifier,
      ],
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error creating material:", error);
    res.status(500).json({ error: "Failed to create material" });
  }
});

app.post("/api/materials/bulk", async (req, res) => {
  const { materials } = req.body;
  if (!materials || !Array.isArray(materials)) {
    return res.status(400).json({ error: "Materials array required" });
  }

  if (useMock) {
    let imported = 0;
    materials.forEach((mat) => {
      const idx = mockMaterials.findIndex((m) => m.ref_code === mat.ref_code);
      const newMat = {
        ...mat,
        id:
          idx >= 0
            ? mockMaterials[idx].id
            : mockMaterials.length > 0
              ? Math.max(...mockMaterials.map((m) => m.id)) + 1
              : 1,
        price: mat.price || 0,
        unit: mat.unit || "Piece",
        items_per_box: mat.items_per_box || 1,
        currency: mat.currency || "USD",
        width_cm: mat.width_cm || 0,
        length_cm: mat.length_cm || 0,
        thickness_m: mat.thickness_m || 0,
        usage: mat.usage || "Interior",
        updated_at: new Date().toISOString(),
      };
      if (idx >= 0) {
        mockMaterials[idx] = newMat;
      } else {
        mockMaterials.push(newMat);
      }
      imported++;
    });
    return res.json({ success: true, imported: materials.length });
  }

  try {
    let imported = 0;
    for (const mat of materials) {
      await pool.query(
        `INSERT INTO materials (ref_code, name, category, subcategory, price, currency, unit, items_per_box, width_cm, length_cm, thickness_m, description, image_url, usage, prompt_modifier, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP)
         ON CONFLICT (ref_code) DO UPDATE SET
           name = EXCLUDED.name,
           category = EXCLUDED.category,
           subcategory = EXCLUDED.subcategory,
           price = EXCLUDED.price,
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
           updated_at = CURRENT_TIMESTAMP`,
        [
          mat.ref_code,
          mat.name,
          mat.category,
          mat.subcategory,
          mat.price || 0,
          mat.currency || "USD",
          mat.unit || "Piece",
          mat.items_per_box || 1,
          mat.width_cm || 0,
          mat.length_cm || 0,
          mat.thickness_m || 0,
          mat.description,
          mat.image_url,
          mat.usage || "Interior",
          mat.prompt_modifier,
        ],
      );
      imported++;
    }
    res.json({ success: true, imported });
  } catch (error) {
    console.error("Error bulk importing materials:", error);
    res.status(500).json({ error: "Failed to import materials" });
  }
});

app.put("/api/materials/:id", async (req, res) => {
  const { id } = req.params;
  const {
    ref_code,
    name,
    category,
    subcategory,
    price,
    currency,
    unit,
    items_per_box,
    width_cm,
    length_cm,
    thickness_m,
    description,
    image_url,
    usage,
    prompt_modifier,
  } = req.body;

  if (useMock) {
    const idx = mockMaterials.findIndex((m) => String(m.id) === String(id));
    if (idx >= 0) {
      mockMaterials[idx] = {
        ...mockMaterials[idx],
        ref_code,
        name,
        category,
        subcategory,
        price: price || 0,
        unit: unit || "Piece",
        items_per_box: items_per_box || 1,
        currency: currency || "USD",
        width_cm: width_cm || 0,
        length_cm: length_cm || 0,
        thickness_m: thickness_m || 0,
        description,
        image_url,
        usage: usage || "Interior",
        prompt_modifier,
        updated_at: new Date().toISOString(),
      };
      return res.json(mockMaterials[idx]);
    }
    return res.status(404).json({ error: "Not found" });
  }

  try {
    const result = await pool.query(
      `UPDATE materials SET ref_code=$1, name=$2, category=$3, subcategory=$4, price=$5, currency=$6, unit=$7, items_per_box=$8, width_cm=$9, length_cm=$10, thickness_m=$11, description=$12, image_url=$13, usage=$14, prompt_modifier=$15, updated_at=CURRENT_TIMESTAMP
       WHERE id=$16 RETURNING *`,
      [
        ref_code,
        name,
        category,
        subcategory,
        price,
        currency || "USD",
        unit,
        items_per_box,
        width_cm,
        length_cm,
        thickness_m,
        description,
        image_url,
        usage,
        prompt_modifier,
        id,
      ],
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating material:", error);
    res.status(500).json({ error: "Failed to update material" });
  }
});

app.delete("/api/materials/:id", async (req, res) => {
  const { id } = req.params;
  if (useMock) {
    mockMaterials = mockMaterials.filter((m) => String(m.id) !== String(id));
    return res.json({ success: true });
  }
  try {
    await pool.query("DELETE FROM materials WHERE id = $1", [id]);
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting material:", error);
    res.status(500).json({ error: "Failed to delete material" });
  }
});

app.delete("/api/materials", async (req, res) => {
  if (useMock) {
    mockMaterials = [];
    return res.json({ success: true });
  }
  try {
    await pool.query("DELETE FROM materials");
    res.json({ success: true });
  } catch (error) {
    console.error("Error clearing materials:", error);
    res.status(500).json({ error: "Failed to clear materials" });
  }
});

if (isProduction) {
  app.use(express.static(distPath));

  app.use((req, res, next) => {
    if (req.method === "GET" && !req.path.startsWith("/api")) {
      return res.sendFile(path.join(distPath, "index.html"));
    }
    next();
  });
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Server running on port ${PORT}${isProduction ? " (production)" : " (development)"}`,
  );
});
