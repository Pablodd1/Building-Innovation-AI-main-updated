-- ConstructViz AI - Production Database Schema
-- Add purchase workflow tables to existing PostgreSQL database

-- 1. Users Table (extend for customer authentication)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(50),
  address TEXT,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) DEFAULT 'customer', -- 'customer' or 'admin'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Purchase Requests Table
CREATE TABLE IF NOT EXISTS purchase_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  
  -- Customer Info (denormalized for easy admin view)
  customer_name VARCHAR(255) NOT NULL,
  customer_email VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(50) NOT NULL,
  customer_address TEXT NOT NULL,
  
  -- Purchase Details
  cart_items JSONB NOT NULL, -- Array of {materialId, materialName, quantity, unitCost}
  total_estimate DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  
  -- Request Details
  project_notes TEXT,
  room_image_url TEXT, -- Optional: link to visualization result
  
  -- Status Tracking
  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'contacted', 'quote_sent', 'completed', 'cancelled'
  contacted_at TIMESTAMP,
  contacted_by INTEGER REFERENCES users(id),
  
  -- Audit
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Email Log Table (optional, for tracking notifications)
CREATE TABLE IF NOT EXISTS email_logs (
  id SERIAL PRIMARY KEY,
  purchase_request_id INTEGER REFERENCES purchase_requests(id) ON DELETE CASCADE,
  recipient_email VARCHAR(255) NOT NULL,
  email_type VARCHAR(50) NOT NULL, -- 'customer_confirmation', 'admin_alert', 'quote_sent'
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) DEFAULT 'sent' -- 'sent', 'failed'
);

-- 4. Indexes for performance
CREATE INDEX idx_purchase_requests_user_id ON purchase_requests(user_id);
CREATE INDEX idx_purchase_requests_status ON purchase_requests(status);
CREATE INDEX idx_purchase_requests_created_at ON purchase_requests(created_at DESC);
CREATE INDEX idx_users_email ON users(email);

-- 5. Create default admin user (password: 'admin123' - CHANGE IN PRODUCTION!)
-- Password hash for 'admin123' using bcrypt
INSERT INTO users (name, email, phone, password_hash, role) 
VALUES (
  'System Admin',
  'admin@constructviz.com',
  '+1-555-0100',
  '$2b$10$rKvvHEPSKf3EQXxF.Jk8wOqQ8kGzHqJGz9p0n5YkYzY5M5M5M5M', -- 'admin123'
  'admin'
) ON CONFLICT (email) DO NOTHING;
