/**
 * ldap-sync.js
 * Sincronización de usuarios desde Active Directory (LDAP) → client_users
 *
 * Variables de entorno necesarias en el backend:
 *   LDAP_URL          ldap://192.168.1.10:389
 *   LDAP_BIND_DN      CN=ldap-reader,CN=Users,DC=electrans,DC=es
 *   LDAP_BIND_PASS    contraseña_usuario_lectura
 *   LDAP_BASE_DN      DC=electrans,DC=es
 *   LDAP_FILTER       (&(objectClass=person)(mail=*)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))
 */

const ldap    = require('ldapjs');
const { pool } = require('./db');

// ── Helpers ──────────────────────────────────────────────────────────────────

function getConfig() {
  const url      = process.env.LDAP_URL;
  const bindDN   = process.env.LDAP_BIND_DN;
  const bindPass = process.env.LDAP_BIND_PASS;
  const baseDN   = process.env.LDAP_BASE_DN;
  const filter   = process.env.LDAP_FILTER ||
    '(&(objectClass=person)(mail=*)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))';

  if (!url || !bindDN || !bindPass || !baseDN) {
    throw new Error('Faltan variables de entorno LDAP (LDAP_URL, LDAP_BIND_DN, LDAP_BIND_PASS, LDAP_BASE_DN)');
  }
  return { url, bindDN, bindPass, baseDN, filter };
}

function attr(entry, name) {
  const a = entry.attributes.find(x => x.type === name);
  if (!a) return null;
  const val = a.vals?.[0] ?? a.values?.[0] ?? null;
  return val ? String(val).trim() : null;
}

// ── Fetch users from LDAP ────────────────────────────────────────────────────

function fetchLdapUsers(config) {
  return new Promise((resolve, reject) => {
    const client = ldap.createClient({
      url:            config.url,
      timeout:        10000,
      connectTimeout: 10000,
      tlsOptions:     { rejectUnauthorized: false },
    });

    client.on('error', err => reject(new Error(`LDAP conexión: ${err.message}`)));

    client.bind(config.bindDN, config.bindPass, (err) => {
      if (err) { client.destroy(); return reject(new Error(`LDAP bind: ${err.message}`)); }

      const users = [];
      const opts = {
        scope:      'sub',
        filter:     config.filter,
        attributes: [
          'sAMAccountName',
          'givenName',
          'sn',
          'mail',
          'telephoneNumber',
          'mobile',
          'department',
          'title',
          'physicalDeliveryOfficeName',
          'employeeID',
          'employeeNumber',
          'distinguishedName',
        ],
        paged:      true,
        sizeLimit:  5000,
      };

      client.search(config.baseDN, opts, (err, res) => {
        if (err) { client.destroy(); return reject(new Error(`LDAP search: ${err.message}`)); }

        res.on('searchEntry', entry => {
          const firstName = attr(entry, 'givenName');
          const lastName  = attr(entry, 'sn');
          const email     = attr(entry, 'mail');
          if (!firstName || !lastName || !email) return; // campos mínimos obligatorios

          users.push({
            username:    attr(entry, 'sAMAccountName'),
            first_name:  firstName,
            last_name:   lastName,
            email:       email.toLowerCase(),
            phone:       attr(entry, 'telephoneNumber') || attr(entry, 'mobile'),
            department:  attr(entry, 'department'),
            position:    attr(entry, 'title'),
            office:      attr(entry, 'physicalDeliveryOfficeName'),
            employee_id: attr(entry, 'employeeID') || attr(entry, 'employeeNumber'),
          });
        });

        res.on('error', err => { client.destroy(); reject(new Error(`LDAP result: ${err.message}`)); });

        res.on('end', () => {
          client.unbind();
          resolve(users);
        });
      });
    });
  });
}

// ── Sync to DB ───────────────────────────────────────────────────────────────

async function syncToDB(ldapUsers) {
  const client = await pool.connect();
  let inserted = 0, updated = 0, skipped = 0, errors = [];

  try {
    await client.query('BEGIN');

    for (const u of ldapUsers) {
      try {
        // Check if exists by email (most reliable key)
        const existing = await client.query(
          'SELECT id FROM client_users WHERE email = $1',
          [u.email]
        );

        if (existing.rows.length > 0) {
          // Update existing
          await client.query(
            `UPDATE client_users SET
               first_name  = $1,
               last_name   = $2,
               phone       = COALESCE($3, phone),
               department  = COALESCE($4, department),
               position    = COALESCE($5, position),
               employee_id = COALESCE($6, employee_id),
               updated_at  = NOW()
             WHERE email = $7`,
            [
              u.first_name, u.last_name,
              u.phone, u.department, u.position,
              u.employee_id, u.email
            ]
          );
          updated++;
        } else {
          // Insert new
          await client.query(
            `INSERT INTO client_users
               (first_name, last_name, email, phone, department, position, employee_id, active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, true)
             ON CONFLICT (email) DO NOTHING`,
            [
              u.first_name, u.last_name, u.email,
              u.phone, u.department, u.position, u.employee_id
            ]
          );
          inserted++;
        }
      } catch (rowErr) {
        skipped++;
        errors.push(`${u.email}: ${rowErr.message}`);
      }
    }

    // Save last sync timestamp
    await client.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('ldap_last_sync', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(new Date().toISOString())]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { total: ldapUsers.length, inserted, updated, skipped, errors };
}

// ── Main export ──────────────────────────────────────────────────────────────

async function runSync() {
  console.log('🔄 Iniciando sincronización LDAP...');
  const start = Date.now();
  try {
    const config    = getConfig();
    const ldapUsers = await fetchLdapUsers(config);
    console.log(`   → ${ldapUsers.length} usuarios encontrados en el AD`);
    const result    = await syncToDB(ldapUsers);
    const elapsed   = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`✅ Sync LDAP completado en ${elapsed}s: +${result.inserted} nuevos, ~${result.updated} actualizados, ${result.skipped} errores`);
    return { ok: true, ...result, elapsed: parseFloat(elapsed) };
  } catch (err) {
    console.error('❌ Error en sync LDAP:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { runSync };
