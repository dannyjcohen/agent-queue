#!/usr/bin/env node
/**
 * hash-password.js
 *
 * Usage:
 *   node scripts/hash-password.js <password>
 *
 * Prints the bcrypt hash to stdout. Copy it to AUTH_PASSWORD_HASH in Vercel:
 *   npx vercel env rm AUTH_PASSWORD_HASH production --yes
 *   echo "<hash>" | npx vercel env add AUTH_PASSWORD_HASH production
 *
 * Then redeploy: npx vercel --prod
 */

const bcrypt = require('bcryptjs');

const password = process.argv[2];
if (!password) {
  console.error('Usage: node scripts/hash-password.js <password>');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 12);
console.log(hash);
