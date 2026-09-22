const crypto = require('crypto');
const fs = require('fs');
const https = require('https');

const keyId = 'K6U3G26Z6X';
const issuerId = '096ec78e-15be-4faa-8b8e-1ead9d107b5a';
const privateKey = fs.readFileSync('C:/Users/jasme/Downloads/AuthKey_K6U3G26Z6X.p8', 'utf8');

function generateToken() {
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: issuerId,
    iat: now,
    exp: now + 1200,
    aud: 'appstoreconnect-v1'
  };

  const b64Url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsignedToken = `${b64Url(header)}.${b64Url(payload)}`;

  const signer = crypto.createSign('SHA256');
  signer.update(unsignedToken);
  signer.end();
  const signature = signer.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }, 'base64url');

  return `${unsignedToken}.${signature}`;
}

async function apiRequest(endpoint, method = 'GET', body = null) {
  const token = generateToken();
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint.startsWith('http') ? endpoint : `https://api.appstoreconnect.apple.com${endpoint}`);
    const req = https.request(url, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, headers: res.headers, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function setEncryption(buildId) {
  const payload = {
    data: {
      type: 'builds',
      id: buildId,
      attributes: {
        usesNonExemptEncryption: false
      }
    }
  };
  const res = await apiRequest(`/v1/builds/${buildId}`, 'PATCH', payload);
  console.log(`Set encryption response [${res.status}]:`, JSON.stringify(res.data, null, 2));
  return res;
}

async function attachBuildToVersion(versionId, buildId) {
  const payload = {
    data: {
      type: 'builds',
      id: buildId
    }
  };
  const res = await apiRequest(`/v1/appStoreVersions/${versionId}/relationships/build`, 'PATCH', payload);
  console.log(`Attach build response [${res.status}]:`, JSON.stringify(res.data, null, 2));
  return res;
}

module.exports = { apiRequest, generateToken, setEncryption, attachBuildToVersion };

if (require.main === module) {
  const action = process.argv[2] || 'status';
  (async () => {
    try {
      if (action === 'status') {
        const appRes = await apiRequest('/v1/apps?filter[bundleId]=com.buildinginnovation.app');
        const appId = appRes.data?.data?.[0]?.id;
        if (appId) {
          const buildsRes = await apiRequest(`/v1/builds?filter[app]=${appId}&sort=-uploadedDate&limit=10`);
          console.log('\n--- Recent Builds ---');
          for (const b of (buildsRes.data?.data || [])) {
            console.log(`Build ID: ${b.id}, Version: ${b.attributes.version}, ProcessingState: ${b.attributes.processingState}, Uploaded: ${b.attributes.uploadedDate}, MinOS: ${b.attributes.minOsVersion}, UsesEncryption: ${b.attributes.usesNonExemptEncryption}`);
          }

          const versionsRes = await apiRequest(`/v1/apps/${appId}/appStoreVersions`);
          console.log('\n--- App Store Versions ---');
          for (const v of (versionsRes.data?.data || [])) {
            console.log(`Version ID: ${v.id}, VersionString: ${v.attributes.versionString}, State: ${v.attributes.appStoreState}`);
          }
        }
      } else if (action === 'xcode-versions') {
        const res = await apiRequest('/v1/ciXcodeVersions');
        console.log('Xcode versions:', JSON.stringify(res.data, null, 2));
      } else if (action === 'set-encryption') {
        const buildId = process.argv[3];
        if (!buildId) throw new Error('Missing buildId');
        await setEncryption(buildId);
      } else if (action === 'attach-build') {
        const versionId = process.argv[3] || 'd404823e-67f7-4394-95b6-7e0416804bab';
        const buildId = process.argv[4];
        if (!buildId) throw new Error('Missing buildId');
        await attachBuildToVersion(versionId, buildId);
      } else if (action === 'update-review-notes') {
        const reviewDetailId = process.argv[3] || '9adb07af-8a64-4803-8dc5-b4265652a930';
        const reviewNotes = [
          '[GUIDELINE 2.1 COMPLIANCE INFORMATION & REVIEWER INSTRUCTIONS]',
          '',
          '1. APP PURPOSE & TARGET AUDIENCE:',
          'Building Innovation AI is designed for homeowners, interior designers, contractors, and architects to visualize architectural finishes (SPC wall panels, PVC marble sheets, acoustic slats, and flooring) in real physical rooms. The app eliminates guesswork by rendering real catalog materials in perspective with accurate lighting and calculates material quantities, surface area, and estimated project costs.',
          '',
          '2. DEMO ACCOUNT & CREDENTIALS:',
          '- Demo Email: reviewer@buildingapp.us',
          '- Demo Password: Reviewer2026!',
          '- Demo Account Required: Yes (or tap "Skip for now (Demo)" to test in guest mode)',
          '',
          '3. STEP-BY-STEP REVIEWER TESTING INSTRUCTIONS:',
          'a. Launch the app and log in with the demo credentials above (or tap Demo mode).',
          'b. Select any sample room photo from the built-in gallery or take a picture with the camera.',
          'c. The AI automatically analyzes room lighting, surface geometry, and dimensions.',
          'd. Browse the material catalog and select any wall/floor product (e.g. "Lamina PVC Blanco Brillante").',
          'e. Tap "GENERATE VIEW" to render the realistic material overlay with interactive before/after split slider.',
          'f. Review the Instant Material Estimator calculating panel count, square meters, and budget.',
          'g. Account Deletion (Guideline 5.1.1(v)): Tap the delete account icon in the header, confirm the permanent wipe prompt, and verify that the account session and data are removed.',
          '',
          '4. CORE EXTERNAL SERVICES & INTEGRATIONS:',
          '- AI Processing: Google Gemini API & OpenAI Inpainting for room analysis and texture perspective rendering.',
          '- Database & Backend: Secure Node.js VPS backend (https://buildingapp.us) with user and catalog database.',
          '- Media Storage: Cloudinary CDN for fast, high-res material catalog texture delivery.',
          '- Payment Processing: Stripe API (for optional subscription tier upgrades).',
          '',
          '5. REGIONAL CONSISTENCY:',
          'The app operates consistently worldwide across all 175 storefronts with no regional restrictions or geofencing. Bilingual support (English & Spanish) and unit system toggles (Imperial / Metric) are built-in.',
          '',
          '6. REGULATORY & IP COMPLIANCE:',
          'Building Innovation AI operates in the architectural visualization space. All catalog items, brand assets, and textures are proprietary property of Building Innovation LLC and authorized partners.'
        ].join('\n');

        const payload = {
          data: {
            type: 'appStoreReviewDetails',
            id: reviewDetailId,
            attributes: {
              demoAccountName: 'reviewer@buildingapp.us',
              demoAccountPassword: 'Reviewer2026!',
              demoAccountRequired: true,
              notes: reviewNotes
            }
          }
        };

        const res = await apiRequest(`/v1/appStoreReviewDetails/${reviewDetailId}`, 'PATCH', payload);
        console.log(`Update Review Notes response [status ${res.status}]:`, JSON.stringify(res.data, null, 2));
      }
    } catch (err) {
      console.error('Error:', err);
    }
  })();
}
