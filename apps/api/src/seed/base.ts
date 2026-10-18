import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import type pg from 'pg';
import { PERMISSIONS, SEED_ROLES, passwordProblem } from '@tqm/shared';

// seed:base (SPEC §20.1). Idempotent and safe in production: inserts what is missing, refreshes permission
// descriptions, never overwrites an admin's role edits. Grows in Milestone 3 (defects, AQL, garments, templates).
export type SeedBaseOptions = {
  adminUsername: string | undefined;
  adminPassword: string | undefined;
  bcryptRounds: number;
  log?: (msg: string) => void;
};

export async function seedBase(client: pg.ClientBase, opts: SeedBaseOptions): Promise<void> {
  const log = opts.log ?? (() => undefined);
  await client.query('begin');
  try {
    for (const [key, p] of Object.entries(PERMISSIONS)) {
      await client.query(
        `insert into permissions (key, description, area) values ($1, $2, $3)
         on conflict (key) do update set description = excluded.description, area = excluded.area`,
        [key, p.description, p.area],
      );
    }
    log(`permissions: ${Object.keys(PERMISSIONS).length}`);

    let created = 0;
    for (const role of SEED_ROLES) {
      const existing = await client.query<{ id: string }>('select id from roles where key = $1', [role.key]);
      if (existing.rows[0]) {
        // Super Admin must always hold every permission, including ones added by later versions.
        if (role.key === 'super_admin') {
          await client.query(
            'insert into role_permissions (role_id, permission_key) select $1, key from permissions on conflict do nothing',
            [existing.rows[0].id],
          );
        }
        continue;
      }
      const id = randomUUID();
      await client.query('insert into roles (id, key, name, default_shell, is_system) values ($1, $2, $3, $4, true)', [
        id,
        role.key,
        role.name,
        role.defaultShell,
      ]);
      await client.query('insert into role_permissions (role_id, permission_key) select $1, unnest($2::text[])', [id, role.permissions]);
      created++;
    }
    log(`roles: ${created} created, ${SEED_ROLES.length - created} already present`);

    const users = await client.query<{ n: number }>('select count(*)::int as n from users');
    if (users.rows[0]?.n === 0 && (!opts.adminUsername || !opts.adminPassword)) {
      log('no users yet: set SEED_ADMIN_USERNAME and SEED_ADMIN_PASSWORD to create the first admin');
    } else if (users.rows[0]?.n === 0 && opts.adminUsername && opts.adminPassword) {
      const problem = passwordProblem(opts.adminPassword);
      if (problem) throw new Error(`SEED_ADMIN_PASSWORD: ${problem}`);
      const id = randomUUID();
      const hash = await bcrypt.hash(opts.adminPassword, opts.bcryptRounds);
      await client.query(
        `insert into users (id, username, full_name, password_hash, must_change_password, is_super_admin)
         values ($1, $2, 'Administrator', $3, true, true)`,
        [id, opts.adminUsername, hash],
      );
      await client.query("insert into user_roles (user_id, role_id) select $1, id from roles where key = 'super_admin'", [id]);
      log(`super admin "${opts.adminUsername}" created (must change password on first login)`);
    }
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  }
}
