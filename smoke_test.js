#!/usr/bin/env node
// smoke_test.js — Full authentication smoke test for buildingapp.us
// Usage: node smoke_test.js [base_url]
// Defaults to https://buildingapp.us if no URL supplied

const BASE_URL = process.argv[2] || 'https://buildingapp.us';
const TEST_EMAIL = `smoketest_${Date.now()}@buildingapp.us`;
const TEST_PASSWORD = 'SmokeTe$t123!';
const TEST_NAME = 'Smoke Test User';

async function fetchJSON(url, options = {}) {
    const res = await fetch(url, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { status: res.status, ok: res.ok, json };
}

async function run() {
    console.log(`\n🔥 Smoke Test — ${BASE_URL}\n`);

    // ── 1. Health Check ──────────────────────────────────────────────────────
    console.log('1️⃣  Health check...');
    const health = await fetchJSON(`${BASE_URL}/api/health`);
    if (!health.ok) { console.error('❌ Health check FAILED:', health.json); process.exit(1); }
    console.log(`   ✅ Server OK (status: ${health.json.status})\n`);

    // ── 2. Signup ────────────────────────────────────────────────────────────
    console.log('2️⃣  Signup with new user...');
    const signup = await fetchJSON(`${BASE_URL}/api/auth/signup`, {
        method: 'POST',
        body: JSON.stringify({ name: TEST_NAME, email: TEST_EMAIL, password: TEST_PASSWORD }),
    });
    if (!signup.ok) { console.error('❌ Signup FAILED:', signup.json); process.exit(1); }
    const signupUser = signup.json.user;
    console.log(`   ✅ Signed up: ${signupUser.email} (id=${signupUser.id})\n`);

    // ── 3. Login ─────────────────────────────────────────────────────────────
    console.log('3️⃣  Login with new credentials...');
    const login = await fetchJSON(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    });
    if (!login.ok) { console.error('❌ Login FAILED:', login.json); process.exit(1); }
    const sessionToken = login.json.user?.session_token;
    if (!sessionToken) { console.error('❌ No session_token in login response:', login.json); process.exit(1); }
    console.log(`   ✅ Logged in, token: ${sessionToken.substring(0, 20)}...\n`);

    // ── 4. Wrong password (negative test) ────────────────────────────────────
    console.log('4️⃣  Wrong password (expect 401)...');
    const badLogin = await fetchJSON(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        body: JSON.stringify({ email: TEST_EMAIL, password: 'wrong' }),
    });
    if (badLogin.status !== 401) { console.error('❌ Expected 401 for wrong password, got:', badLogin.status); process.exit(1); }
    console.log(`   ✅ Correctly rejected wrong password (401)\n`);

    // ── 5. Protected test route ───────────────────────────────────────────────
    console.log('5️⃣  Protected route with valid token...');
    const protected_ = await fetchJSON(`${BASE_URL}/api/protected-test`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
    });
    if (!protected_.ok) { console.error('❌ Protected route FAILED:', protected_.json); process.exit(1); }
    console.log(`   ✅ Protected route OK: ${JSON.stringify(protected_.json)}\n`);

    // ── 6. Protected route without token (expect 401) ─────────────────────────
    console.log('6️⃣  Protected route without token (expect 401)...');
    const unauth = await fetchJSON(`${BASE_URL}/api/protected-test`);
    if (unauth.status !== 401) { console.error('❌ Expected 401 without token, got:', unauth.status); process.exit(1); }
    console.log(`   ✅ Correctly rejected missing token (401)\n`);

    console.log('🎉 All smoke tests PASSED!\n');
}

run().catch(err => { console.error('💥 Unexpected error:', err); process.exit(1); });
