// Telegram alerts — configure TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID for production

let _botToken = process.env.TELEGRAM_BOT_TOKEN || '';
// Authoritative chat ID: Jasmel's personal ID (7838956683). The .env on Hostinger
// previously had the bot's OWN numeric id (7731333606) pasted into TELEGRAM_CHAT_ID,
// which made every send fail with "bot can't send messages to the bot". We hardcode
// the correct owner chat id as the fallback AND reject the known-bad value so a stale
// Hostinger-injected env can never break delivery again.
const OWNER_CHAT_ID = '7838956683';
const BOT_ID = '7731333606';
let _chatId = (process.env.TELEGRAM_CHAT_ID && process.env.TELEGRAM_CHAT_ID !== BOT_ID)
    ? process.env.TELEGRAM_CHAT_ID
    : OWNER_CHAT_ID;

async function sendTelegramMessage(text: string, parse_mode?: string): Promise<boolean> {
    if (!_botToken) {
        console.log(`[Telegram] Would send: ${text.substring(0, 120)}...`);
        return false;
    }
    try {
        const url = `https://api.telegram.org/bot${_botToken}/sendMessage`;
        const body: any = { chat_id: _chatId, text };
        if (parse_mode) body.parse_mode = parse_mode;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!data.ok) {
            console.warn('[Telegram] API error:', data.description);
            return false;
        }
        return true;
    } catch (e) {
        console.warn('[Telegram] Send failed:', e);
        return false;
    }
}

export const telegramAlerts = {
    async send(message: string) {
        const ok = await sendTelegramMessage(message);
        return { sent: ok, reason: ok ? '' : 'Telegram alerts not configured or failed' };
    },

    async sendMessage({ text, parse_mode }: { text: string; parse_mode?: string }): Promise<boolean> {
        return sendTelegramMessage(text, parse_mode);
    },

    async sendErrorAlert(error: Error, context?: string): Promise<void> {
        const msg = `<b>🚨 Error Alert</b>\n\n<b>Error:</b> <code>${(error.message || String(error)).substring(0, 300)}</code>${context ? `\n<b>Context:</b> ${context.substring(0, 300)}` : ''}`;
        await sendTelegramMessage(msg, 'HTML');
    },

    async sendHealthAlert(health: any): Promise<boolean> {
        const status = health.checks?.apiKey?.ok ? '✅' : '❌';
        const msg = `<b>📊 Health Check</b>\n\nAPI Key: ${status}\nUptime: ${health.uptime}s\nErrors: ${health.usage?.errors || 0}`;
        return sendTelegramMessage(msg, 'HTML');
    }
};

export async function initTelegramFromConfig(): Promise<void> {
    try {
        const fs = await import('fs');
        const path = await import('path');
        const configPaths = [
            path.join(process.cwd(), 'data', 'config.json'),
            path.resolve('data', 'config.json')
        ];
        for (const p of configPaths) {
            if (fs.existsSync(p)) {
                const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
                if (cfg.TELEGRAM_BOT_TOKEN) _botToken = cfg.TELEGRAM_BOT_TOKEN;
                if (cfg.TELEGRAM_CHAT_ID) _chatId = cfg.TELEGRAM_CHAT_ID;
                console.log('[Telegram] Initialized from config file');
                return;
            }
        }
    } catch (e) {
        console.warn('[Telegram] Config init failed:', e);
    }
}
