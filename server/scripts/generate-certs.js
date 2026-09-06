// scripts/generate-certs.js
// Generates a self-signed TLS certificate for local HTTPS/WSS development.
// Run with: npm run certs
//
// This is for LOCAL DEV ONLY. Your browser will show a "not secure" warning
// the first time you visit https://localhost:3000 - that's expected for a
// self-signed cert. Click through it (Advanced -> Proceed) once.
//
// In real production, don't use this script - use certs from a real CA
// (e.g. Let's Encrypt via certbot, or whatever your hosting provider issues).

const fs = require('fs');
const path = require('path');
const selfsigned = require('selfsigned');

const CERTS_DIR = path.join(__dirname, '..', 'certs');
const KEY_PATH = path.join(CERTS_DIR, 'key.pem');
const CERT_PATH = path.join(CERTS_DIR, 'cert.pem');

if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)) {
  console.log('Certs already exist at server/certs/ - delete them first if you want to regenerate.');
  process.exit(0);
}

if (!fs.existsSync(CERTS_DIR)) fs.mkdirSync(CERTS_DIR, { recursive: true });

const attrs = [{ name: 'commonName', value: 'localhost' }];
const pems = selfsigned.generate(attrs, {
  days: 365,
  keySize: 2048,
  extensions: [
    {
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: 'localhost' }, // DNS
        { type: 7, ip: '127.0.0.1' }, // IP
      ],
    },
  ],
});

fs.writeFileSync(KEY_PATH, pems.private);
fs.writeFileSync(CERT_PATH, pems.cert);

console.log('Self-signed TLS cert generated at server/certs/');
console.log('Start the server with "npm start" - it will now serve over https:// and wss://.');
console.log('Your browser will warn "not secure" the first time - that is expected for a self-signed cert.');
