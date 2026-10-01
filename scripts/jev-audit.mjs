/**
 * Jev Error Monitoring & Route Health Audit
 * Powered by TypeSafe AI System-1 (`model: 'jev-1'`) & Heuristic Fallback
 */

import { choice, TypeSafeClient } from '@typesafe-ai/sdk';
import https from 'https';
import http from 'http';
import { URL } from 'url';

const BASE_URL = process.env.BASE_URL || 'https://buildingapp.us';
const TYPESAFE_API_KEY = process.env.TYPESAFE_API_KEY || 'apikey_2238961ff151c1db4465b99ec5ef660f41f7_cc5fc6a87e2c7952cf9d512d8c75940ce0aa132dcb4b165a8687ef924c89e878';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL || 'comercial.buildinginnovation@gmail.com';
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';

const AUDIT_ROUTES = [
    { path: '/', name: 'Homepage (AI Visualizer)' },
    { path: '/support', name: 'Support & Help Center' },
    { path: '/privacy', name: 'Privacy Policy' },
    { path: '/terms', name: 'Terms of Service' },
    { path: '/account-deletion', name: 'Account Deletion Portal' },
    { path: '/sitemap.xml', name: 'XML Sitemap' },
    { path: '/robots.txt', name: 'Robots.txt' },
    { path: '/api/health', name: 'System Health API' },
    { path: '/api/materials', name: 'Materials Catalog API' }
];

let typeSafeClient = null;
if (TYPESAFE_API_KEY) {
    try {
        typeSafeClient = new TypeSafeClient({ apiKey: TYPESAFE_API_KEY });
    } catch (e) {
        console.warn('⚠️ Could not initialize TypeSafeClient:', e.message);
    }
}

function fetchUrl(targetUrl, timeoutMs = 8000) {
    return new Promise((resolve) => {
        const parsed = new URL(targetUrl);
        const protocol = parsed.protocol === 'https:' ? https : http;
        const startTime = Date.now();

        const req = protocol.get(targetUrl, { timeout: timeoutMs, headers: { 'User-Agent': 'Jev-Monitor-Audit/1.0' } }, (res) => {
            let body = '';
            res.on('data', (chunk) => {
                if (body.length < 5000) body += chunk; // capture first 5KB
            });
            res.on('end', () => {
                const latencyMs = Date.now() - startTime;
                resolve({
                    url: targetUrl,
                    status: res.statusCode,
                    headers: res.headers,
                    bodySnippet: body.substring(0, 500),
                    latencyMs,
                    error: null
                });
            });
        });

        req.on('timeout', () => {
            req.destroy();
            const latencyMs = Date.now() - startTime;
            resolve({
                url: targetUrl,
                status: 408,
                headers: {},
                bodySnippet: '',
                latencyMs,
                error: 'Request Timeout'
            });
        });

        req.on('error', (err) => {
            const latencyMs = Date.now() - startTime;
            resolve({
                url: targetUrl,
                status: 0,
                headers: {},
                bodySnippet: '',
                latencyMs,
                error: err.message
            });
        });
    });
}

async function classifyWithJev(routeResult) {
    if (typeSafeClient) {
        try {
            const response = await typeSafeClient.systemOne({
                state: {
                    url: routeResult.url,
                    statusCode: routeResult.status,
                    latencyMs: routeResult.latencyMs,
                    error: routeResult.error,
                    snippet: routeResult.bodySnippet.substring(0, 200)
                },
                questions: {
                    is_operational: choice("Is this web route operational and functioning normally?", {
                        yes: null,
                        no: null
                    }),
                    severity: choice("What is the severity of this audit result?", {
                        ok: null,
                        info: null,
                        warning: null,
                        critical: null
                    }),
                    should_alert: choice("Should an automated notification alert be sent for this result?", {
                        no: null,
                        yes: null
                    })
                }
            });

            return {
                source: 'jev-1',
                is_operational: response.answers?.is_operational?.choice === 'yes',
                severity: response.answers?.severity?.choice || 'ok',
                should_alert: response.answers?.should_alert?.choice === 'yes'
            };
        } catch (err) {
            // Graceful fallback to heuristic if rate limit or network issue occurs
        }
    }

    // Heuristic Fallback Engine
    const isOk = routeResult.status >= 200 && routeResult.status < 400;
    const isWarn = routeResult.latencyMs > 4000;
    const isCrit = !isOk;

    return {
        source: 'heuristic-fallback',
        is_operational: isOk,
        severity: isCrit ? 'critical' : isWarn ? 'warning' : 'ok',
        should_alert: isCrit
    };
}

async function dispatchAlert(findings) {
    const criticalAlerts = findings.filter(f => f.classification.should_alert);
    if (criticalAlerts.length === 0) return;

    console.log(`\n🚨 Triggering alerts for ${criticalAlerts.length} issues...`);

    const summary = criticalAlerts.map(a => `• [${a.route.name}] (${a.route.path}) -> Status: ${a.raw.status}, Latency: ${a.raw.latencyMs}ms, Error: ${a.raw.error || 'None'}`).join('\n');

    if (WEBHOOK_URL) {
        try {
            const payload = JSON.stringify({
                text: `🚨 Jev Monitor Alert: Route Failures on ${BASE_URL}\n\n${summary}`,
                alerts: criticalAlerts
            });
            await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload
            });
            console.log('✓ Webhook notification dispatched.');
        } catch (e) {
            console.warn('⚠️ Failed to send webhook alert:', e.message);
        }
    }

    if (RESEND_API_KEY && NOTIFICATION_EMAIL) {
        try {
            await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${RESEND_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    from: 'Jev Monitor <alerts@buildingapp.us>',
                    to: [NOTIFICATION_EMAIL],
                    subject: `🚨 [Jev Alert] Route Failure on ${BASE_URL}`,
                    text: `Jev Automated Audit detected operational issues:\n\n${summary}\n\nTime: ${new Date().toISOString()}`
                })
            });
            console.log(`✓ Email notification sent to ${NOTIFICATION_EMAIL}`);
        } catch (e) {
            console.warn('⚠️ Failed to send email alert:', e.message);
        }
    }
}

async function runAudit() {
    console.log('===============================================================');
    console.log(`🔍 Jev Automated Web Route & Health Audit`);
    console.log(`🎯 Base URL: ${BASE_URL}`);
    console.log(`🤖 Classification Engine: ${typeSafeClient ? 'Jev System-1 (jev-1)' : 'Heuristic Fallback'}`);
    console.log(`⏰ Timestamp: ${new Date().toISOString()}`);
    console.log('===============================================================\n');

    const results = [];
    let errorCount = 0;

    for (const route of AUDIT_ROUTES) {
        const fullUrl = new URL(route.path, BASE_URL).toString();
        const raw = await fetchUrl(fullUrl);
        const classification = await classifyWithJev(raw);

        results.push({ route, raw, classification });

        const icon = classification.severity === 'ok' ? '🟢' : classification.severity === 'warning' ? '🟡' : '🔴';
        console.log(`${icon} [${classification.severity.toUpperCase()}] ${route.name.padEnd(28)} | ${route.path.padEnd(20)} | Status: ${String(raw.status).padEnd(3)} | Latency: ${String(raw.latencyMs).padStart(4)}ms | Source: ${classification.source}`);

        if (!classification.is_operational) {
            errorCount++;
        }
    }

    console.log('\n===============================================================');
    console.log(`📊 Audit Summary: ${results.length} routes scanned | ${results.length - errorCount} operational | ${errorCount} errors`);
    console.log('===============================================================');

    if (errorCount > 0) {
        await dispatchAlert(results);
        process.exit(1);
    } else {
        console.log('🎉 All audited routes are 100% operational with 0 errors!\n');
        process.exit(0);
    }
}

runAudit().catch(err => {
    console.error('Fatal error during Jev audit:', err);
    process.exit(1);
});
