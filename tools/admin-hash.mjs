/*
 * Make the ADMIN_PASSWORD_HASH value for the CRM sign-in:
 *   npm run admin:hash -- "your long password"
 * Paste the printed line into Netlify > Site configuration > Environment variables. The password itself is never stored.
 */
import { hashPassword } from '../server/auth.mjs';

const pw = process.argv[2];
if (!pw || pw.length < 12) {
  console.error('Usage: npm run admin:hash -- "a password of at least 12 characters"');
  process.exit(1);
}
console.log(await hashPassword(pw));
