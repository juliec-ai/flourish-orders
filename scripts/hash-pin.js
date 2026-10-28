// Prints a STAFF_USERS entry with a hashed PIN.
// Usage: npm run hash-pin -- "Julie" julie@brighamfloral.com 1234
const { hashPin } = require('../server/auth');

const [name, email, pin] = process.argv.slice(2);
if (!name || !email || !pin) {
  console.error('Usage: npm run hash-pin -- "Name" email PIN');
  process.exit(1);
}
if (!/^\d{4,8}$/.test(pin)) {
  console.error('PIN must be 4 to 8 digits.');
  process.exit(1);
}
console.log(JSON.stringify({ name, email: email.toLowerCase(), pin: hashPin(pin) }));
