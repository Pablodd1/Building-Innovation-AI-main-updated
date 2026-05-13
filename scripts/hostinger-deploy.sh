#!/bin/bash
# Simple Deployment Script for Hostinger via SSH

echo "🚀 Starting Deployment for Building Innovation AI..."

# 1. Update code from GitHub
echo "📥 Pulling latest changes..."
git pull origin main

# 2. Install dependencies
echo "📦 Installing dependencies..."
npm install

# 3. Build frontend and backend
echo "🏗️ Building application..."
npm run build

# 4. Restart the Node.js process (Assuming PM2 is used, otherwise manage via hPanel)
if command -v pm2 &> /dev/null
then
    echo "🔄 Restarting via PM2..."
    pm2 restart all
else
    echo "⚠️ PM2 not found. Please restart the application manually via Hostinger hPanel."
fi

echo "✅ Deployment complete! Check Telegram for the startup alert."
