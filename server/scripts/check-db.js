import fs from 'node:fs';
import path from 'node:path';
import { env, ROOT } from '../config/env.js';

/**
 * Diagnoses MongoDB connection problems without leaking the password.
 * Run with:  npm run check-db
 */

const RESET = '\u001b[0m';
const RED = '\u001b[31m';
const GREEN = '\u001b[32m';
const YELLOW = '\u001b[33m';
const DIM = '\u001b[2m';

const ok = (m) => console.log(`${GREEN}  ok${RESET}   ${m}`);
const bad = (m) => console.log(`${RED}  FAIL${RESET} ${m}`);
const warn = (m) => console.log(`${YELLOW}  warn${RESET} ${m}`);
const info = (m) => console.log(`${DIM}       ${m}${RESET}`);

/** Replaces the password with **** so the URI is safe to paste into a chat. */
export function maskUri(uri) {
  return String(uri).replace(/^(\w+(?:\+\w+)?:\/\/[^:@/]*:)([^@]*)(@)/, (_, a, _p, c) => `${a}****${c}`);
}

console.log('\nMongoDB connection check\n');

// 1 — is there a .env file at all?
const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
  ok(`.env found at ${envPath}`);
} else {
  bad(`.env NOT found at ${envPath}`);
  info('Run:  copy .env.example .env      (Windows)');
  info('      cp .env.example .env        (Mac/Linux)');
  process.exit(1);
}

// 2 — how many times is MONGODB_URI defined? dotenv keeps the first one.
const raw = fs.readFileSync(envPath, 'utf8');
const lines = raw.split(/\r?\n/);
const hits = lines
  .map((line, i) => ({ line, n: i + 1 }))
  .filter(({ line }) => /^\s*MONGODB_URI\s*=/.test(line));

if (hits.length === 0) {
  bad('No MONGODB_URI line found in .env');
  process.exit(1);
} else if (hits.length > 1) {
  warn(`MONGODB_URI is defined ${hits.length} times (lines ${hits.map((h) => h.n).join(', ')})`);
  info('Only the FIRST one is used. Delete or comment out the others.');
} else {
  ok(`MONGODB_URI defined once, on line ${hits[0].n}`);
}

// 3 — inspect the exact characters dotenv produced
const uri = env.MONGODB_URI;
console.log(`\n  Value in use: ${maskUri(uri)}`);
console.log(`  Length: ${uri.length} characters`);

const weird = [...uri]
  .map((ch, i) => ({ ch, i, code: ch.codePointAt(0) }))
  .filter(({ code }) => code < 32 || code === 127 || (code > 127 && code < 160) || code === 0xfeff || code === 0x200b);

if (weird.length) {
  bad(`Found ${weird.length} invisible/control character(s) inside the URI:`);
  for (const w of weird) info(`position ${w.i}: U+${w.code.toString(16).padStart(4, '0').toUpperCase()}`);
  info('Retype the line by hand in Notepad — do not paste from a web page or PDF.');
} else {
  ok('No invisible or control characters');
}

// 4 — structural checks
let fatal = false;

if (!/^mongodb(\+srv)?:\/\//.test(uri)) {
  bad('Does not start with mongodb:// or mongodb+srv://');
  info(`It starts with: ${JSON.stringify(uri.slice(0, 14))}`);
  info('Atlas connection strings need exactly two slashes: mongodb+srv://');
  fatal = true;
} else {
  ok('Scheme is valid');
}

const hostMatch = uri.match(/^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]*)/);
const host = hostMatch?.[1] ?? '';
if (!host) {
  bad('No host found — this is what "Protocol and host list are required" means');
  info('Expected: mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/dbname');
  fatal = true;
} else if (host.includes('@')) {
  bad(`Host looks wrong: "${host}"`);
  info('Your password almost certainly contains an "@" that must be written as %40.');
  info('Example: pa@ss  ->  pa%40ss');
  info('Easiest fix: change the Atlas password to letters and digits only.');
  fatal = true;
} else {
  ok(`Host: ${host}`);
}

if (/<|>/.test(uri)) {
  bad('The URI still contains < or > — those are placeholders from the Atlas page');
  info('Replace <db_password> with the real password, and remove the angle brackets.');
  fatal = true;
}

if (/\/\/username:password@|:password@/.test(uri)) {
  bad('The URI still says username:password literally');
  info('Replace those with the database user you created in Atlas → Database Access.');
  fatal = true;
}

const afterHost = uri.slice(uri.indexOf(host) + host.length);
const dbName = afterHost.startsWith('/') ? afterHost.slice(1).split('?')[0] : '';
if (!dbName) {
  warn('No database name in the URI');
  info('Add one before the "?", e.g. .../flussonic-crm?retryWrites=true&w=majority');
} else {
  ok(`Database name: ${dbName}`);
}

const pw = uri.match(/^mongodb(?:\+srv)?:\/\/[^:@/]*:([^@]*)@/)?.[1] ?? '';
if (/[:/?#[\]@%]/.test(decodeURIComponent(pw || ''))) {
  warn('The password contains a character that must be percent-encoded');
  info('@ becomes %40, : becomes %3A, / becomes %2F, # becomes %23');
  info('Easiest fix: set an Atlas password with only letters and digits.');
}

if (fatal) {
  console.log(`\n${RED}Fix the items above, then run this check again.${RESET}\n`);
  process.exit(1);
}

// 5 — try the real connection
console.log('\n  Connecting…');
const mongoose = (await import('mongoose')).default;
try {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 12000 });
  ok('Connected successfully');
  const admin = mongoose.connection.db.admin();
  const { version } = await admin.serverInfo().catch(() => ({ version: 'unknown' }));
  info(`Server version: ${version}`);
  info(`Database: ${mongoose.connection.name}`);
  await mongoose.disconnect();
  console.log(`\n${GREEN}All good — run: npm start${RESET}\n`);
} catch (err) {
  bad(err.message.split('\n')[0]);
  const m = err.message;
  if (/authentication failed|bad auth/i.test(m)) {
    info('The username or password is wrong.');
    info('Atlas → Database Access → check the user, or set a new simple password.');
  } else if (/IP|whitelist|not allowed/i.test(m) || /ServerSelection/i.test(m)) {
    info('Atlas is refusing your address, or the cluster name is wrong.');
    info('Atlas → Network Access → Add IP Address → Allow access from anywhere (0.0.0.0/0).');
    info('Also check the cluster hostname is copied exactly.');
  } else if (/ENOTFOUND|querySrv/i.test(m)) {
    info('The cluster hostname does not resolve. Check it for typos.');
  }
  console.log('');
  process.exit(1);
}
