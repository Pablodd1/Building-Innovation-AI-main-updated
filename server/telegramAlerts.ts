// Telegram alerts stub — configure bot token for production
export const telegramAlerts = {
    async send(message: string) {
        console.log(`[Telegram] Would send alert: ${message}`);
        return { sent: false, reason: 'Telegram alerts not configured' };
    }
};

export const TelegramAlerts = telegramAlerts;
