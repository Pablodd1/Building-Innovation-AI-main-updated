import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.DATABASE_URL?.replace('sqlite:', '') || path.join(process.cwd(), 'data', 'app.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initTables();
  }
  return db;
}

function initTables() {
  const database = getDb();
  
  // Users table
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      name TEXT,
      tier TEXT DEFAULT 'free',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Quota tracking
  database.exec(`
    CREATE TABLE IF NOT EXISTS quota_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      date TEXT,
      count INTEGER DEFAULT 0,
      UNIQUE(user_id, date)
    )
  `);

  // Generation logs
  database.exec(`
    CREATE TABLE IF NOT EXISTS generation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      material_id TEXT,
      material_name TEXT,
      category TEXT,
      success INTEGER,
      duration_ms INTEGER,
      model TEXT,
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // API health logs
  database.exec(`
    CREATE TABLE IF NOT EXISTS health_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT,
      status INTEGER,
      response_time_ms INTEGER,
      error TEXT,
      checked_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
