// Grants a role to an existing user. Operator tool: self-registration always creates
// WORKER accounts, and there is no role-management API yet (that arrives with user
// administration). Needs direct database access through DATABASE_URL.
//
//   npm run user:set-role -w @fieldops/api -- manager@example.com MANAGER
//
// Existing sessions keep working and pick up the new role on their next request, because
// the API reads the role from the database, not from the access token.

import pg from 'pg';

const ROLES = ['WORKER', 'MANAGER', 'ADMIN'];
const [email, role] = process.argv.slice(2);

if (email === undefined || role === undefined || !ROLES.includes(role)) {
  process.stderr.write(`Usage: npm run user:set-role -- <email> <${ROLES.join('|')}>\n`);
  process.exit(1);
}
if (process.env.DATABASE_URL === undefined) {
  process.stderr.write('DATABASE_URL is not set (apps/api/.env).\n');
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const result = await client.query(
    'UPDATE users SET role = $1::"Role", updated_at = now() WHERE email = $2 RETURNING id',
    [role, email.trim().toLowerCase()],
  );
  if (result.rowCount === 0) {
    process.stderr.write(`No user with email ${email}.\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`${email} is now ${role}.\n`);
  }
} finally {
  await client.end();
}
