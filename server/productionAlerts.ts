// Production Alert System for BuildingApp
// Sends alerts via Email (primary) and Telegram (secondary)
// Uses Brevo SMTP for reliable email delivery

import nodemailer from 'nodemailer';

// Brevo SMTP Configuration
const SMTP_HOST = 'smtp-relay.brevo.com';
const SMTP_PORT = 587;
const SMTP_USER = 'jasmel@medicalbillingmb.com';
const SMTP_PASS = process.env.SMTP_PASSWORD || process.env.BREVO_SMTP_KEY || '';
const ALERT_EMAIL = process.env.ALERT_EMAIL || 'jasmelacosta@gmail.com';

interface AlertConfig {
  email: string;
  telegram?: boolean;
  cooldownMinutes: number;
}

class ProductionAlerts {
  private transporter: nodemailer.Transporter | null = null;
  private lastAlertTime: Map<string, number> = new Map();
  private alertConfig: AlertConfig;
  private emailEnabled: boolean = false;

  constructor(config?: Partial<AlertConfig>) {
    this.alertConfig = {
      email: ALERT_EMAIL,
      telegram: false,
      cooldownMinutes: 5,
      ...config,
    };
    this.initEmail();
  }

  private initEmail() {
    if (!SMTP_PASS) {
      console.warn('[Alerts] SMTP password not configured. Email alerts disabled.');
      return;
    }

    try {
      this.transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: false,
        auth: {
          user: SMTP_USER,
          pass: SMTP_PASS,
        },
      });
      this.emailEnabled = true;
      console.log('[Alerts] Email alerts configured');
    } catch (e) {
      console.error('[Alerts] Failed to configure email:', e);
    }
  }

  private isOnCooldown(type: string): boolean {
    const now = Date.now();
    const lastSent = this.lastAlertTime.get(type) || 0;
    const cooldownMs = this.alertConfig.cooldownMinutes * 60 * 1000;
    return now - lastSent < cooldownMs;
  }

  private markSent(type: string) {
    this.lastAlertTime.set(type, Date.now());
  }

  async sendEmailAlert(subject: string, htmlBody: string, force: boolean = false): Promise<boolean> {
    if (!this.emailEnabled || !this.transporter) {
      console.warn('[Alerts] Email not configured');
      return false;
    }

    try {
      await this.transporter.sendMail({
        from: `"BuildingApp Alerts" <${SMTP_USER}>`,
        to: this.alertConfig.email,
        subject: `🏗️ BuildingApp: ${subject}`,
        html: htmlBody,
      });
      console.log(`[Alerts] Email sent: ${subject}`);
      return true;
    } catch (e: any) {
      console.error('[Alerts] Email failed:', e.message);
      return false;
    }
  }

  // ===== ALERT TEMPLATES =====

  async sendErrorAlert(error: Error, context?: string, force: boolean = false): Promise<boolean> {
    if (!force && this.isOnCooldown('error')) {
      console.log('[Alerts] Error alert skipped (cooldown)');
      return false;
    }

    const subject = `🚨 ERROR: ${error.message.substring(0, 50)}`;
    const html = `
      <h2>🚨 BuildingApp Error Alert</h2>
      <p><strong>Error:</strong> ${error.message}</p>
      ${context ? `<p><strong>Context:</strong> ${context}</p>` : ''}
      <p><strong>Time:</strong> ${new Date().toISOString()}</p>
      <p><strong>Stack:</strong></p>
      <pre>${error.stack || 'No stack trace'}</pre>
      <hr>
      <p><a href="https://buildingapp.us/api/admin/dashboard">View Dashboard</a></p>
    `;

    this.markSent('error');
    return this.sendEmailAlert(subject, html, force);
  }

  async sendHealthAlert(health: any, force: boolean = false): Promise<boolean> {
    if (!force && this.isOnCooldown('health')) {
      console.log('[Alerts] Health alert skipped (cooldown)');
      return false;
    }

    const statusEmoji = {
      apiKey: health.checks.apiKey.ok ? '✅' : '❌',
      database: health.checks.database.ok ? '✅' : '⚠️',
      staticFiles: health.checks.staticFiles.ok ? '✅' : '❌',
      serverBundle: health.checks.serverBundle.ok ? '✅' : '❌',
    };

    const subject = `🏗️ Health Report — ${health.checks.apiKey.ok ? 'All Good' : 'Issues Detected'}`;
    const html = `
      <h2>🏗️ BuildingApp Health Report</h2>
      
      <h3>System Status</h3>
      <ul>
        <li>${statusEmoji.apiKey} API Key: ${health.checks.apiKey.message}</li>
        <li>${statusEmoji.database} Database: ${health.checks.database.message}</li>
        <li>${statusEmoji.staticFiles} Static Files: ${health.checks.staticFiles.size} files</li>
        <li>${statusEmoji.serverBundle} Server Bundle: ${health.checks.serverBundle.size} MB</li>
      </ul>
      
      <h3>Usage Statistics</h3>
      <ul>
        <li>Total Requests: ${health.usage.totalRequests}</li>
        <li>API Calls: ${health.usage.apiCalls}</li>
        <li>AI Generations: ${health.usage.aiGenerations}</li>
        <li>Material Views: ${health.usage.materialViews}</li>
        <li>Errors: ${health.usage.errors}</li>
      </ul>
      
      <p><strong>Uptime:</strong> ${Math.floor(health.uptime / 60)}m ${health.uptime % 60}s</p>
      <p><strong>Commit:</strong> ${health.commit}</p>
      <p><strong>Time:</strong> ${new Date(health.timestamp).toLocaleString()}</p>
      
      <hr>
      <p><a href="https://buildingapp.us/api/admin/dashboard">View Dashboard</a></p>
    `;

    this.markSent('health');
    return this.sendEmailAlert(subject, html, force);
  }

  async sendStartupAlert(commit: string, port: number): Promise<boolean> {
    const subject = `🚀 App Started`;
    const html = `
      <h2>🚀 BuildingApp Started</h2>
      <ul>
        <li><strong>Commit:</strong> ${commit}</li>
        <li><strong>Port:</strong> ${port}</li>
        <li><strong>Time:</strong> ${new Date().toISOString()}</li>
        <li><strong>Node:</strong> ${process.version}</li>
        <li><strong>Env:</strong> ${process.env.NODE_ENV || 'development'}</li>
      </ul>
      <hr>
      <p><a href="https://buildingapp.us/api/admin/dashboard">View Dashboard</a></p>
    `;

    return this.sendEmailAlert(subject, html, true);
  }

  async sendPurchaseAlert(purchase: any): Promise<boolean> {
    const subject = `💰 New Purchase: $${purchase.totalPrice}`;
    const html = `
      <h2>💰 New Purchase Request</h2>
      <ul>
        <li><strong>Customer:</strong> ${purchase.customerName}</li>
        <li><strong>Company:</strong> ${purchase.company || 'N/A'}</li>
        <li><strong>Material:</strong> ${purchase.materialName}</li>
        <li><strong>Quantity:</strong> ${purchase.quantity}</li>
        <li><strong>Total:</strong> $${purchase.totalPrice}</li>
        <li><strong>Email:</strong> ${purchase.customerEmail}</li>
        <li><strong>Phone:</strong> ${purchase.phone || 'N/A'}</li>
      </ul>
      <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
    `;

    return this.sendEmailAlert(subject, html, true);
  }

  async sendSecurityAlert(ip: string, reason: string, details?: string): Promise<boolean> {
    if (this.isOnCooldown('security')) {
      console.log('[Alerts] Security alert skipped (cooldown)');
      return false;
    }

    const subject = `🔒 Security Alert: ${reason}`;
    const html = `
      <h2>🔒 BuildingApp Security Alert</h2>
      <ul>
        <li><strong>IP:</strong> ${ip}</li>
        <li><strong>Reason:</strong> ${reason}</li>
        ${details ? `<li><strong>Details:</strong> ${details}</li>` : ''}
        <li><strong>Time:</strong> ${new Date().toISOString()}</li>
      </ul>
    `;

    this.markSent('security');
    return this.sendEmailAlert(subject, html, true);
  }

  getStatus() {
    return {
      emailEnabled: this.emailEnabled,
      alertEmail: this.alertConfig.email,
      telegramEnabled: this.alertConfig.telegram,
      cooldownMinutes: this.alertConfig.cooldownMinutes,
      lastAlerts: Object.fromEntries(this.lastAlertTime),
    };
  }
}

// Singleton
export const productionAlerts = new ProductionAlerts();
export default ProductionAlerts;
