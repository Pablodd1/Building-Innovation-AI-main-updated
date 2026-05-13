// Telegram Alert System for BuildingApp
// Sends notifications via Telegram Bot API

import https from 'https';
import fs from 'fs';
import path from 'path';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '7838956683'; // Jasmel's chat ID

interface TelegramMessage {
  text: string;
  parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  disable_notification?: boolean;
}

export class TelegramAlerts {
  private botToken: string;
  private chatId: string;
  private lastAlertTime: Map<string, number> = new Map();
  private cooldownMs: number = 300000; // 5 min cooldown between same alert type

  constructor(botToken?: string, chatId?: string) {
    this.botToken = botToken || TELEGRAM_BOT_TOKEN;
    this.chatId = chatId || TELEGRAM_CHAT_ID;
  }

  updateToken(botToken: string, chatId?: string) {
    this.botToken = botToken;
    if (chatId) this.chatId = chatId;
  }

  private async sendRequest(path: string, body: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const req = https.request({
        hostname: 'api.telegram.org',
        path: `/bot${this.botToken}${path}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      }, (res) => {
        let responseData = '';
        res.on('data', (chunk) => responseData += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(responseData);
            resolve(parsed);
          } catch (e) {
            resolve({ ok: false, error: responseData });
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.write(data);
      req.end();
    });
  }

  async sendMessage(message: TelegramMessage): Promise<boolean> {
    if (!this.botToken) {
      console.warn('[Telegram] No bot token configured');
      return false;
    }

    try {
      const result = await this.sendRequest('/sendMessage', {
        chat_id: this.chatId,
        text: message.text,
        parse_mode: message.parse_mode || 'HTML',
        disable_notification: message.disable_notification || false,
      });

      if (result.ok) {
        console.log('[Telegram] Message sent successfully');
        return true;
      } else {
        console.error('[Telegram] Failed:', result.description || result.error);
        return false;
      }
    } catch (e: any) {
      console.error('[Telegram] Error:', e.message);
      return false;
    }
  }

  // Check cooldown before sending
  async sendAlert(type: string, message: string, force: boolean = false): Promise<boolean> {
    const now = Date.now();
    const lastSent = this.lastAlertTime.get(type) || 0;

    if (!force && now - lastSent < this.cooldownMs) {
      console.log(`[Telegram] Alert "${type}" skipped (cooldown)`);
      return false;
    }

    this.lastAlertTime.set(type, now);
    return this.sendMessage({
      text: message,
      parse_mode: 'HTML',
    });
  }

  // Pre-built alert templates

  async sendHealthAlert(health: any): Promise<boolean> {
    const statusEmoji = health.checks.apiKey.ok ? '✅' : '❌';
    const dbEmoji = health.checks.database.ok ? '✅' : '⚠️';
    const staticEmoji = health.checks.staticFiles.ok ? '✅' : '❌';
    const bundleEmoji = health.checks.serverBundle.ok ? '✅' : '❌';

    const text = `<b>🏗️ BuildingApp Health Report</b>

<b>API Key:</b> ${statusEmoji} ${health.checks.apiKey.message}
<b>Database:</b> ${dbEmoji} ${health.checks.database.message}
<b>Static Files:</b> ${staticEmoji} ${health.checks.staticFiles.size} files
<b>Server Bundle:</b> ${bundleEmoji} ${health.checks.serverBundle.size} MB

<b>Usage Today:</b>
• Requests: ${health.usage.totalRequests}
• API Calls: ${health.usage.apiCalls}
• AI Generations: ${health.usage.aiGenerations}
• Material Views: ${health.usage.materialViews}
• Errors: ${health.usage.errors}
• <b>Users:</b> ${health.usage.totalUsers}

<b>Uptime:</b> ${Math.floor(health.uptime / 60)}m ${health.uptime % 60}s
<b>Commit:</b> <code>${health.commit}</code>
<b>Time:</b> ${new Date(health.timestamp).toLocaleTimeString()}

<a href="https://buildingapp.us/api/admin/dashboard">View Dashboard</a>`;

    return this.sendAlert('health', text, true); // Force send for scheduled reports
  }

  async sendErrorAlert(error: Error, context?: string): Promise<boolean> {
    const text = `<b>🚨 BuildingApp Error Alert</b>

<b>Error:</b> <code>${error.message}</code>
${context ? `<b>Context:</b> ${context}\n` : ''}
<b>Time:</b> ${new Date().toLocaleTimeString()}
<b>Stack:</b> <pre>${error.stack?.substring(0, 500) || 'No stack trace'}</pre>

<a href="https://buildingapp.us/api/admin/dashboard">View Dashboard</a>`;

    return this.sendAlert('error', text);
  }

  async sendStartupAlert(commit: string, port: number): Promise<boolean> {
    const text = `<b>🚀 BuildingApp Started</b>

<b>Commit:</b> <code>${commit}</code>
<b>Port:</b> ${port}
<b>Time:</b> ${new Date().toLocaleTimeString()}
<b>Node:</b> ${process.version}

<a href="https://buildingapp.us/api/admin/dashboard">View Dashboard</a>`;

    return this.sendAlert('startup', text, true);
  }

  async sendSuccessAlert(message: string, context?: string): Promise<boolean> {
    const text = `<b>✅ BuildingApp Success Notification</b>

<b>Status:</b> ${message}
${context ? `<b>Details:</b> ${context}\n` : ''}
<b>Time:</b> ${new Date().toLocaleTimeString()}

<a href="https://buildingapp.us/api/admin/dashboard">View Dashboard</a>`;

    return this.sendAlert('success', text);
  }

  async sendPurchaseAlert(purchase: any): Promise<boolean> {
    const text = `<b>💰 New Purchase Request</b>

<b>Customer:</b> ${purchase.customerName}
<b>Company:</b> ${purchase.company || 'N/A'}
<b>Material:</b> ${purchase.materialName}
<b>Quantity:</b> ${purchase.quantity}
<b>Total:</b> $${purchase.totalPrice}
<b>Email:</b> ${purchase.customerEmail}
<b>Phone:</b> ${purchase.phone || 'N/A'}

<b>Time:</b> ${new Date().toLocaleTimeString()}`;

    return this.sendAlert('purchase', text, true);
  }
}

// Singleton instance
export const telegramAlerts = new TelegramAlerts();

// Initialize from config file after server starts
export async function initTelegramFromConfig() {
  try {
    // Try multiple config paths
    const configPaths = [
      path.join(process.cwd(), 'data', 'config.json'),
      path.resolve(process.cwd(), '..', 'data', 'config.json'),
      path.resolve(process.cwd(), '..', '..', 'data', 'config.json'),
    ];
    
    for (const configPath of configPaths) {
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.TELEGRAM_BOT_TOKEN) {
          telegramAlerts.updateToken(config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_CHAT_ID);
          console.log('[Telegram] Initialized from config file');
          return;
        }
      }
    }
  } catch (e) {
    // Config not available, use env vars
  }
}
