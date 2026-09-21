import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEnvFile } from './env.mjs';

const root = import.meta.dirname;
const packagePath = path.join(root, 'dist', 'chrome.zip');
const dryRun = process.argv.includes('--dry-run');

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function call(url, options) {
  const response = await fetch(url, options);
  const body = await response.text();

  if (!response.ok) {
    fail(`${options.method} ${url} returned ${response.status}\n${body}`);
  }

  return JSON.parse(body);
}

await loadEnvFile();

const itemId = process.env.CHROME_EXTENSION_ID;
const clientId = process.env.CHROME_CLIENT_ID;
const clientSecret = process.env.CHROME_CLIENT_SECRET;
const refreshToken = process.env.CHROME_REFRESH_TOKEN;

if (!itemId || !clientId || !clientSecret || !refreshToken) {
  fail('Missing CHROME_EXTENSION_ID, CHROME_CLIENT_ID, CHROME_CLIENT_SECRET or CHROME_REFRESH_TOKEN. See "Chrome Web Store" in the README for where each one comes from.');
}

const manifest = JSON.parse(await readFile(path.join(root, 'extension', 'manifest.json'), 'utf8'));

if (dryRun) {
  console.log(`version ${manifest.version}, would upload dist/chrome.zip to Web Store item ${itemId} and publish it`);
  console.log(`credentials: CHROME_CLIENT_ID=${clientId.slice(0, 12)}… (${refreshToken.length}-character refresh token)`);
  process.exit(0);
}

const bundle = await readFile(packagePath).catch(() => fail('No dist/chrome.zip. Run node build.mjs first.'));

const { access_token: token } = await call('https://oauth2.googleapis.com/token', {
  method: 'POST',
  body: new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  })
});

const headers = { authorization: `Bearer ${token}`, 'x-goog-api-version': '2' };

const upload = await call(`https://www.googleapis.com/upload/chromewebstore/v1.1/items/${itemId}?uploadType=media`, {
  method: 'PUT',
  headers,
  body: bundle
});

if (upload.uploadState !== 'SUCCESS') {
  fail(`Upload of version ${manifest.version} came back ${upload.uploadState}:\n${JSON.stringify(upload, null, 2)}`);
}

console.log(`uploaded version ${manifest.version} to item ${itemId}`);

const publish = await call(`https://www.googleapis.com/chromewebstore/v1.1/items/${itemId}/publish`, {
  method: 'POST',
  headers: { ...headers, 'content-length': '0' }
});

console.log(`publish: ${(publish.status ?? ['unknown']).join(', ')}`);

for (const detail of publish.statusDetail ?? []) {
  console.log(`  ${detail}`);
}
