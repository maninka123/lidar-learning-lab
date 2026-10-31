// Usage: npm run hash-password   (type the password when asked; nothing is stored or sent anywhere)
import { randomBytes, scryptSync } from 'node:crypto';
import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.question('Choose an admin password (12+ characters): ', (pw) => {
  rl.close();
  if (pw.length < 12) { console.error('Too short: use at least 12 characters.'); process.exit(1); }
  const salt = randomBytes(16), N = 16384, r = 8, p = 1;
  const hash = scryptSync(pw, salt, 32, { N, r, p });
  console.log('\nADMIN_PASSWORD_HASH=' + `scrypt:${N}:${r}:${p}:${salt.toString('base64')}:${hash.toString('base64')}`);
  console.log('ADMIN_AUTH_SECRET=' + randomBytes(32).toString('base64url') + '   (a new random secret; keep it private)');
});
