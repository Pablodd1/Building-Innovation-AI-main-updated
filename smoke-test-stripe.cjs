const { spawn } = require('child_process');
const http = require('http');

const PORT = 3001;
const SERVER_URL = `http://localhost:${PORT}`;

// 1. Start the server
console.log('Starting server for smoke test...');
const serverProcess = spawn('node', ['--env-file=.env', 'dist-server/app.cjs'], {
  env: { ...process.env, PORT: PORT, NODE_ENV: 'production' },
  stdio: 'pipe'
});

let serverReady = false;

serverProcess.stdout.on('data', (data) => {
  const output = data.toString();
//   console.log(`[SERVER]: ${output.trim()}`);
  if (output.includes(`Server running on port ${PORT}`) || output.includes('Serving from')) {
    serverReady = true;
  }
});

serverProcess.stderr.on('data', (data) => {
  console.error(`[SERVER ERROR]: ${data}`);
});

async function runTests() {
  // Wait for server to start
  let attempts = 0;
  while (!serverReady && attempts < 20) {
    await new Promise(resolve => setTimeout(resolve, 500));
    attempts++;
  }

  if (!serverReady) {
    console.error('Server failed to start in time.');
    serverProcess.kill();
    process.exit(1);
  }

  console.log('Server is ready. Running tests...');
  let testsPassed = true;

  // Test 1: Create Session Endpoint
  console.log('--- Test 1: /api/checkout/create-session ---');
  try {
    const response = await fetch(`${SERVER_URL}/api/checkout/create-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'test_user_123', tier: 'Pro' })
    });
    
    const data = await response.json();
    console.log(`Status: ${response.status}`);
    console.log(`Response:`, data);
    
    if (response.ok && data.id && data.url) {
      console.log('✅ Create Session Endpoint works!');
    } else {
      console.error('❌ Create Session Endpoint failed or returned unexpected data.');
      testsPassed = false;
    }
  } catch (e) {
    console.error('❌ Create Session Endpoint threw an error:', e.message);
    testsPassed = false;
  }

  // Test 2: Webhook Endpoint (Invalid Signature)
  console.log('\n--- Test 2: /api/webhooks/stripe (Invalid Signature) ---');
  try {
    const response = await fetch(`${SERVER_URL}/api/webhooks/stripe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': 't=123,v1=invalid_sig'
      },
      body: JSON.stringify({
        id: 'evt_test_123',
        type: 'checkout.session.completed',
        data: {
            object: {
                client_reference_id: 'test_user_123',
                amount_total: 1000
            }
        }
      })
    });
    
    const text = await response.text();
    console.log(`Status: ${response.status}`);
    console.log(`Response:`, text);
    
    // We expect a 400 Bad Request because the signature is invalid. This means the endpoint is correctly verifying signatures.
    if (response.status === 400 && text.includes('Webhook Error')) {
      console.log('✅ Webhook Endpoint correctly rejected invalid signature!');
    } else {
      console.error('❌ Webhook Endpoint did not behave as expected.');
      testsPassed = false;
    }
  } catch (e) {
    console.error('❌ Webhook Endpoint threw an error:', e.message);
    testsPassed = false;
  }

  // Shutdown
  console.log('\nTests completed.');
  serverProcess.kill();
  if (testsPassed) {
    console.log('🎉 All Smoke Tests Passed!');
    process.exit(0);
  } else {
    console.error('💥 Some Smoke Tests Failed.');
    process.exit(1);
  }
}

// Execute tests
runTests();
