// Hostinger Entry Point
// This file points to the compiled server in dist-server/
import fs from 'fs';
import path from 'path';

// Manually load .env file if it exists (crucial for Hostinger environment)
try {
  const envPath = path.join(process.cwd(), '.env');
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
    console.log('[Hostinger Boot] Loaded environment variables from .env file successfully');
  } else {
    console.warn('[Hostinger Boot] No .env file found at: ' + envPath);
  }
} catch (e) {
  console.error('[Hostinger Boot] Error reading .env file manually:', e.message);
}

import './dist-server/app.cjs';
