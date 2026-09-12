/*
 * Generates PIN hashes + a JWT secret for the verify-pin Edge Function.
 *
 *   node supabase/generate-pins.mjs                      # defaults shown below
 *   node supabase/generate-pins.mjs --admin 1234 --store 5678 --bookstall 9010 --super 2468
 *
 * Outputs values ready to paste into:
 *   supabase secrets set \
 *     ADMIN_PIN_HASH=... STORE_PIN_HASH=... BOOKSTALL_PIN_HASH=... JWT_SECRET=...
 *
 * NOTE: pick your own PINs. The defaults printed here are the legacy codes,
 * shown only as an example — change them before the festival.
 */
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const getArg = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const adminPin = getArg('--admin', process.env.ADMIN_PIN || 'Lifefest26');
const storePin = getArg('--store', process.env.STORE_PIN || 'Bizzastore');
const bookstallPin = getArg('--bookstall', process.env.BOOKSTALL_PIN || 'Bizzabook');
const superPin = getArg('--super', process.env.SUPER_PIN || 'HopeOfUmmah26');

const hash = (role, pin) =>
  crypto.createHash('sha256').update(`rv26:${role}:${pin}`).digest('hex');

const jwtSecret = crypto.randomBytes(32).toString('base64');

console.log('ADMIN_PIN_HASH=' + hash('admin', adminPin));
console.log('STORE_PIN_HASH=' + hash('store', storePin));
console.log('BOOKSTALL_PIN_HASH=' + hash('bookstall', bookstallPin));
console.log('SUPER_PIN_HASH=' + hash('super', superPin));
console.log('JWT_SECRET=' + jwtSecret);
console.log('');
console.log('Run:  supabase functions deploy verify-pin chat');
console.log('Then: supabase secrets set ADMIN_PIN_HASH=<above> STORE_PIN_HASH=<above> BOOKSTALL_PIN_HASH=<above> SUPER_PIN_HASH=<above> JWT_SECRET=<above> GEMINI_API_KEY=<your key>');