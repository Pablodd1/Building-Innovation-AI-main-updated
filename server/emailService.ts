// server/emailService.ts
// Notificaciones de compra / cotización.
//
// Antes este archivo era un STUB: solo hacía console.log('Would send…') y devolvía
// `Email service not configured`. Por eso ninguna cotización llegaba por correo al cliente
// ni al equipo, aunque el endpoint respondía 201 con `emailSent:false` y nadie lo miraba.
//
// Ahora envía de verdad cuando hay credenciales:
//   · RESEND_API_KEY (+ RESEND_FROM)  → API de Resend
//   · SMTP_HOST/SMTP_USER/SMTP_PASS   → SMTP (cPanel, Brevo, Gmail app-password…)
// Sin credenciales devuelve success:false con el motivo exacto — nunca finge un envío.

import { sendEmailViaProvider } from './leadAlerts';

interface PurchaseLike {
    userEmail?: string;
    userName?: string;
    customer_email?: string;
    customer_name?: string;
    total_estimate?: number | string;
    totalEstimate?: number | string;
    currency?: string;
    project_notes?: string;
    materials?: Array<{ name: string; quantity?: number; unitCost?: number }>;
    cart_items?: Array<{ materialName?: string; name?: string; quantity?: number; unitCost?: number }>;
    [key: string]: any;
}

const ADMIN_EMAIL = () => process.env.LEAD_ALERT_TO || process.env.ADMIN_EMAIL || 'lidermarketingonline@espaciosimportados.com.co';

function normalizeItems(p: PurchaseLike): Array<{ name: string; quantity?: number; unitCost?: number }> {
    if (Array.isArray(p.materials) && p.materials.length) return p.materials;
    const cart = Array.isArray(p.cart_items) ? p.cart_items : [];
    return cart.map((i) => ({
        name: i.materialName || i.name || 'Material',
        quantity: i.quantity,
        unitCost: i.unitCost,
    }));
}

export async function sendPurchaseNotifications(params: PurchaseLike) {
    const userEmail = String(params.userEmail || params.customer_email || '').trim();
    const userName = String(params.userName || params.customer_name || 'Cliente');
    const items = normalizeItems(params);
    const total = params.total_estimate ?? params.totalEstimate;
    const currency = params.currency || 'USD';

    const rows = items
        .map((i) => `<tr><td>${i.name}</td><td>${i.quantity ?? ''}</td><td>${i.unitCost ?? ''}</td></tr>`)
        .join('');
    const html = `<h2>Nueva solicitud de cotización</h2>
<p><b>Cliente:</b> ${userName}<br><b>Email:</b> ${userEmail || 'sin email'}<br><b>Total estimado:</b> ${total ?? ''} ${currency}</p>
${params.project_notes ? `<p><b>Notas:</b> ${params.project_notes}</p>` : ''}
<table border="1" cellpadding="6" cellspacing="0"><tr><th>Material</th><th>Cantidad</th><th>Costo unitario</th></tr>${rows}</table>`;

    const results = {
        customer: { success: false, reason: 'no_email' } as { success: boolean; reason?: string },
        admin: { success: false, reason: 'no_email' } as { success: boolean; reason?: string },
    };

    if (userEmail) {
        const r = await sendEmailViaProvider(
            `Tu cotización en BuildingApp — ${items.map((i) => i.name).join(', ').slice(0, 120)}`,
            html, userEmail);
        results.customer = r.sent ? { success: true } : { success: false, reason: r.reason };
    }
    const admin = await sendEmailViaProvider(
        `Nueva cotización: ${userName} — ${items.length} material(es)`,
        html, ADMIN_EMAIL());
    results.admin = admin.sent ? { success: true } : { success: false, reason: admin.reason };

    if (!results.customer.success && !results.admin.success) {
        console.warn('[Email] purchase notifications not delivered:', results.customer.reason || results.admin.reason);
    }
    return results;
}
