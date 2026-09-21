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

module.exports = { apiRequest, generateToken };

if (require.main === module) {
  const action = process.argv[2] || 'status';
  (async () => {
    try {
      if (action === 'status') {
        const appRes = await apiRequest('/v1/apps?filter[bundleId]=com.buildinginnovation.app');
        console.log('App info:', JSON.stringify(appRes.data, null, 2));

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
      }
    } catch (err) {
      console.error('Error:', err);
    }
  })();
}
