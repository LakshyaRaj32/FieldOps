// Operator tool: grants a role to an existing user, optionally putting them in an
// organization. Needed to bootstrap the platform's first SUPER_ADMIN (there is, by design,
// no API that creates one) and handy in development. Everything else is done through the
// API: super admins create organizations and their admins, organization admins create
// members. Needs direct database access through DATABASE_URL.
//
//   npm run user:set-role -w @fieldops/api -- root@example.com SUPER_ADMIN
//   npm run user:set-role -w @fieldops/api -- raj@example.com MANAGER "Nike Operations"
//   npm run user:set-role -w @fieldops/api -- raj@example.com MANAGER "Nike Operations" --org-wide
//
// The organization is found by name and created if it does not exist. Existing sessions
// keep working and pick up the change on their next request, because the API reads role and
// organization from the database, not from the access token.

import pg from 'pg';

const ROLES = ['WORKER', 'MANAGER', 'ORGANIZATION_ADMIN', 'SUPER_ADMIN'];
const args = process.argv.slice(2);
const orgWide = args.includes('--org-wide');
const [email, role, organizationName] = args.filter(arg => arg !== '--org-wide');

function usage(message) {
  process.stderr.write(
    `${message}\nUsage: npm run user:set-role -- <email> <${ROLES.join('|')}> ["<organization name>"] [--org-wide]\n`,
  );
  process.exit(1);
}

if (email === undefined || role === undefined || !ROLES.includes(role)) {
  usage('Missing or unknown arguments.');
}
if (role === 'SUPER_ADMIN' && organizationName !== undefined) {
  usage('A SUPER_ADMIN belongs to the platform, not to an organization.');
}
if (orgWide && role !== 'MANAGER') {
  usage('--org-wide applies to managers only.');
}
if (process.env.DATABASE_URL === undefined) {
  process.stderr.write('DATABASE_URL is not set (apps/api/.env).\n');
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('BEGIN');
  let organizationId = null;
  if (organizationName !== undefined) {
    const found = await client.query(
      'SELECT id FROM organizations WHERE name = $1',
      [organizationName],
    );
    organizationId =
      found.rows[0]?.id ??
      (
        await client.query(
          'INSERT INTO organizations (id, name, updated_at) VALUES (gen_random_uuid(), $1, now()) RETURNING id',
          [organizationName],
        )
      ).rows[0].id;
  }
  const result = await client.query(
    `UPDATE users SET role = $1::"Role",
       organization_id = CASE WHEN $1 = 'SUPER_ADMIN' THEN NULL ELSE coalesce($3::uuid, organization_id) END,
       organization_wide_access = $4, updated_at = now()
     WHERE email = $2 RETURNING id, organization_id`,
    [role, email.trim().toLowerCase(), organizationId, orgWide],
  );
  if (result.rowCount === 0) {
    await client.query('ROLLBACK');
    process.stderr.write(`No user with email ${email}.\n`);
    process.exitCode = 1;
  } else {
    await client.query('COMMIT');
    const where =
      result.rows[0].organization_id === null
        ? role === 'SUPER_ADMIN'
          ? ' (platform)'
          : ' (no organization yet: add one to give them data)'
        : organizationName === undefined
          ? ''
          : ` in ${organizationName}`;
    process.stdout.write(`${email} is now ${role}${orgWide ? ' with organization-wide access' : ''}${where}.\n`);
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await client.end();
}
