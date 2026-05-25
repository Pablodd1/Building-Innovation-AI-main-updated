// Email service stub — configure SMTP credentials for production
export async function sendPurchaseNotifications(params: {
    userEmail: string;
    userName: string;
    materials: Array<{ name: string; quantity: number }>;
}) {
    const { userEmail, userName, materials } = params;
    // In production, integrate with Brevo/SendGrid/etc.
    console.log(`[Email] Would send purchase notification to ${userEmail} for ${userName}`);
    console.log(`[Email] Materials: ${materials.map(m => `${m.name} x${m.quantity}`).join(', ')}`);
    return {
        customer: { success: false, reason: 'Email service not configured' },
        admin: { success: false, reason: 'Email service not configured' }
    };
}
