// server/leadAlerts.ts
// Aviso al equipo de ventas cuando un cliente renderiza un material.
//
// Problema que cierra: un visitante se registra, sube la foto de su sala y renderiza
// "Panel WPC Roble Claro (05)" o "Lámina Mármol Fusión M-07"… y nadie se enteraba.
// El render quedaba en generation_log (analítica interna) pero no salía ningún aviso
// con nombre, email y material exacto hacia una persona de ventas.
//
// Reglas de diseño:
//   · Un aviso por cliente+material cada 24 h (persistido en data/lead-alerts.json) para
//     que quien prueba 10 veces el mismo material no genere 10 avisos.
//   · Nunca bloquea ni rompe el render: se llama en fire-and-forget y todo va en try/catch.
//   · Canales: Telegram (ya configurado en este servidor) + email si hay RESEND_API_KEY
//     o SMTP_HOST/USER/PASS. Sin credenciales de email NO se inventa nada: se informa
//     `email_not_configured` y el aviso sigue saliendo por Telegram.
//   · Incluye un enlace wa.me con el mensaje ya redactado: el asesor abre WhatsApp con
//     un toque y envía desde su propio número. No requiere API ni registro A2P.

import fs from 'fs';
import path from 'path';
import { telegramAlerts } from './telegramAlerts';

const STATE_PATH = path.join(process.cwd(), 'data', 'lead-alerts.json');
const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface RenderLead {
    userId?: string | number | null;
    userName?: string;
    userEmail?: string;
    userPhone?: string;
    materialName?: string;
    materialRef?: string;
    category?: string;
    mode?: string;
    provider?: string;
    model?: string;
}

function loadState(): Record<string, number> {
    try {
        if (!fs.existsSync(STATE_PATH)) return {};
        return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8') || '{}');
    } catch {
        return {};
    }
}

function saveState(state: Record<string, number>): void {
    try {
        fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
        fs.writeFileSync(STATE_PATH, JSON.stringify(state));
    } catch (e) {
        console.warn('[LeadAlerts] could not persist state:', (e as Error)?.message);
    }
}

/** true = hay que avisar (y queda marcado); false = ya se avisó en las últimas 24 h. */
export function shouldNotify(key: string, now: number = Date.now(), windowMs: number = WINDOW_MS): boolean {
    const state = loadState();
    if (now - (state[key] || 0) < windowMs) return false;
    state[key] = now;
    for (const k of Object.keys(state)) {
        if (now - state[k] > 7 * WINDOW_MS) delete state[k];
    }
    saveState(state);
    return true;
}

export function leadKey(lead: RenderLead): string {
    const who = String(lead.userId || lead.userEmail || lead.userPhone || 'anon');
    const what = String(lead.materialRef || lead.materialName || 'material');
    return `${who}::${what}`;
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as Record<string, string>)[c]);

export function bogotaStamp(d: Date = new Date()): string {
    const fmt = new Intl.DateTimeFormat('es-CO', {
        timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d).reduce((acc, p) => (acc[p.type] = p.value, acc), {} as Record<string, string>);
    return `${fmt.day}/${fmt.month}/${fmt.year} ${fmt.hour}:${fmt.minute} (Bogotá)`;
}

export function buildWhatsAppLink(phone: string, text: string): string {
    const digits = String(phone || '').replace(/[^\d]/g, '');
    if (!digits) return '';
    return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function buildLeadMessage(lead: RenderLead, when: Date = new Date()): string {
    const who = esc(lead.userName || (lead.userId ? 'Cliente registrado (sin nombre)' : 'Visitante sin cuenta'));
    const email = esc(lead.userEmail || 'sin email');
    const phone = esc(lead.userPhone || 'sin teléfono');
    const material = esc(lead.materialName || 'material sin nombre');
    const ref = lead.materialRef ? ` · ref ${esc(lead.materialRef)}` : '';
    const cat = lead.category ? `\n<b>Categoría:</b> ${esc(lead.category)}` : '';
    const mode = lead.mode ? `\n<b>Render:</b> ${esc(lead.mode)}${lead.provider ? ` (${esc(lead.provider)}${lead.model ? `/${esc(lead.model)}` : ''})` : ''}` : '';
    const wa = buildWhatsAppLink(String(lead.userPhone || ''),
        `Hola ${lead.userName || ''}, gracias por tu interés en ${lead.materialName || 'nuestro material'}. ¿Quieres que te ayude con cantidades, precio y envío?`);
    const waLine = wa ? `\n\n<b>Contactar:</b> <a href="${wa}">abrir WhatsApp del cliente</a>` : '';
    return `<b>🏠 Nuevo render de interés</b>\n\n`
        + `<b>Cliente:</b> ${who}\n`
        + `<b>Email:</b> ${email}\n`
        + `<b>Teléfono:</b> ${phone}\n`
        + `<b>Material:</b> ${material}${ref}${cat}${mode}\n`
        + `<b>Cuándo:</b> ${esc(bogotaStamp(when))}`
        + waLine;
}

/** Email por Resend o SMTP cuando exista credencial. Devuelve el motivo si no se pudo. */
export async function sendEmailViaProvider(subject: string, html: string, to: string): Promise<{ sent: boolean; reason?: string }> {
    const resendKey = String(process.env.RESEND_API_KEY || '').trim();
    if (resendKey) {
        try {
            const r = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
                body: JSON.stringify({
                    from: process.env.RESEND_FROM || 'BuildingApp <alertas@cedexx.net>',
                    to: [to], subject, html,
                }),
            });
            if (r.ok) return { sent: true };
            return { sent: false, reason: `resend_${r.status}` };
        } catch (e) {
            return { sent: false, reason: `resend_error:${(e as Error)?.message}` };
        }
    }
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (host && user && pass) {
        try {
            const nodemailer = await import('nodemailer');
            const transport = nodemailer.createTransport({
                host,
                port: Number(process.env.SMTP_PORT || 465),
                secure: String(process.env.SMTP_SECURE || 'true') !== 'false',
                auth: { user, pass },
            });
            await transport.sendMail({
                from: process.env.SMTP_FROM || user,
                to, subject, html,
            });
            return { sent: true };
        } catch (e) {
            return { sent: false, reason: `smtp_error:${(e as Error)?.message}` };
        }
    }
    return { sent: false, reason: 'email_not_configured' };
}

/**
 * Avisa al equipo de ventas. Nunca lanza: cualquier fallo se registra y se devuelve.
 */
export async function notifyRenderLead(lead: RenderLead): Promise<{ sent: boolean; deduped?: boolean; telegram?: boolean; email?: boolean; reason?: string }> {
    try {
        if (!lead.materialName && !lead.materialRef) return { sent: false, reason: 'no_material' };
        // Cliente identificado: 1 aviso por material cada 24 h. Visitante anónimo: 1 por hora
        // (puede haber varios visitantes probando el mismo material y no queremos perder el lead).
        const identified = !!(lead.userId || lead.userEmail || lead.userPhone);
        const windowMs = identified ? WINDOW_MS : 60 * 60 * 1000;
        if (!shouldNotify(leadKey(lead), Date.now(), windowMs)) return { sent: false, deduped: true };

        const text = buildLeadMessage(lead);
        const html = text.replace(/\n/g, '<br>').replace(/<b>/g, '<strong>').replace(/<\/b>/g, '</strong>');
        const subject = `Nuevo render: ${lead.materialName || lead.materialRef} — ${lead.userName || lead.userEmail || 'cliente'}`;
        const to = process.env.LEAD_ALERT_TO || process.env.ADMIN_EMAIL || 'lidermarketingonline@espaciosimportados.com.co';

        const [tg, mail] = await Promise.all([
            telegramAlerts.sendMessage({ text, parse_mode: 'HTML' }).catch((e: any) => {
                console.warn('[LeadAlerts] telegram failed:', e?.message);
                return false;
            }),
            sendEmailViaProvider(subject, html, to).catch((e: any) => ({ sent: false, reason: String(e?.message) })),
        ]);

        const emailOk = !!(mail as any)?.sent;
        if (!tg && !emailOk) {
            console.warn(`[LeadAlerts] lead ${leadKey(lead)} not delivered: telegram=false email=${(mail as any)?.reason}`);
        }
        return { sent: !!tg || emailOk, telegram: !!tg, email: emailOk, reason: emailOk ? undefined : (mail as any)?.reason };
    } catch (e: any) {
        console.warn('[LeadAlerts] notifyRenderLead failed:', e?.message);
        return { sent: false, reason: e?.message || 'unknown' };
    }
}
