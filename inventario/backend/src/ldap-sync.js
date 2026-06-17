/**
 * ldap-sync.js
 * Sincronización de usuarios desde Active Directory (LDAP) → client_users
 */

const ldap     = require('ldapjs');
const { pool } = require('./db');

// ── Config ────────────────────────────────────────────────────────────────────

function getConfig() {
  const url      = process.env.LDAP_URL;
  const bindDN   = process.env.LDAP_BIND_DN;
  const bindPass = process.env.LDAP_BIND_PASS;
  const baseDN   = process.env.LDAP_BASE_DN;
  const filter   = process.env.LDAP_FILTER ||
    '(&(objectClass=person)(mail=*)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))';

  if (!url || !bindDN || !bindPass || !baseDN)
    throw new Error('Faltan variables LDAP (LDAP_URL, LDAP_BIND_DN, LDAP_BIND_PASS, LDAP_BASE_DN)');

  return { url, bindDN, bindPass, baseDN, filter };
}

// Extrae el primer valor de un atributo LDAP (compatible con ldapjs v3)
function attr(entry, name) {
  // ldapjs v3 expone los atributos como objeto pojo o array
  if (entry.pojo) {
    const a = entry.pojo.attributes.find(x => x.type === name);
    if (!a || !a.values || !a.values.length) return null;
    return String(a.values[0]).trim() || null;
  }
  // Fallback para otras versiones
  if (entry.attributes) {
    const a = Array.isArray(entry.attributes)
      ? entry.attributes.find(x => x.type === name)
      : entry.attributes[name];
    if (!a) return null;
    const val = a.vals?.[0] ?? a.values?.[0] ?? a[0] ?? null;
    return val ? String(val).trim() : null;
  }
  return null;
}

// ── Fetch desde LDAP ─────────────────────────────────────────────────────────

function fetchLdapUsers(config) {
  return new Promise((resolve, reject) => {
    const client = ldap.createClient({
      url:            config.url,
      timeout:        15000,
      connectTimeout: 10000,
      tlsOptions:     { rejectUnauthorized: false },
    });

    let settled = false;
    const done = (err, val) => {
      if (settled) return;
      settled = true;
      if (err) reject(err); else resolve(val);
    };

    client.on('error', err => done(new Error(`LDAP conexión: ${err.message}`)));

    client.bind(config.bindDN, config.bindPass, (err) => {
      if (err) {
        client.destroy();
        return done(new Error(`LDAP bind: ${err.message}`));
      }

      const users = [];
      const opts = {
        scope:      'sub',
        filter:     config.filter,
        attributes: [
          'sAMAccountName', 'givenName', 'sn', 'mail',
          'telephoneNumber', 'mobile', 'department', 'title',
          'physicalDeliveryOfficeName', 'employeeID', 'employeeNumber',
        ],
        paged:     { pageSize: 200 },
        sizeLimit: 0,
      };

      client.search(config.baseDN, opts, (err, res) => {
        if (err) {
          client.destroy();
          return done(new Error(`LDAP search: ${err.message}`));
        }

        res.on('searchEntry', entry => {
          try {
            const firstName = attr(entry, 'givenName');
            const lastName  = attr(entry, 'sn');
            const email     = attr(entry, 'mail');
            if (!firstName || !lastName || !email) return;

            users.push({
              first_name:  firstName,
              last_name:   lastName,
              email:       email.toLowerCase().trim(),
              phone:       attr(entry, 'telephoneNumber') || attr(entry, 'mobile'),
              department:  attr(entry, 'department'),
              position:    attr(entry, 'title'),
              employee_id: attr(entry, 'employeeID') || attr(entry, 'employeeNumber'),
            });
          } catch (_) {}
        });

        res.on('error',  err => done(new Error(`LDAP result: ${err.message}`)));
        res.on('end',    ()  => { try { client.unbind(); } catch (_) {} done(null, users); });
      });
    });
  });
}

// ── Sync a BD ─────────────────────────────────────────────────────────────────

async function syncToDB(ldapUsers) {
  const client = await pool.connect();
  let inserted = 0, updated = 0, skipped = 0;
  const errors = [];

  try {
    await client.query('BEGIN');

    for (const u of ldapUsers) {
      // SAVEPOINT por usuario: si falla, hacemos rollback solo de ese registro
      // y la transacción global sigue viva para los demás.
      try {
        await client.query('SAVEPOINT sp_user');

        const { rows } = await client.query(
          'SELECT id FROM client_users WHERE email = $1',
          [u.email]
        );

        if (rows.length > 0) {
          await client.query(
            `UPDATE client_users SET
               first_name  = $1,
               last_name   = $2,
               phone       = COALESCE($3, phone),
               department  = COALESCE($4, department),
               position    = COALESCE($5, position),
               employee_id = COALESCE(NULLIF($6,''), employee_id),
               updated_at  = NOW()
             WHERE email = $7`,
            [u.first_name, u.last_name, u.phone, u.department,
             u.position, u.employee_id || '', u.email]
          );
          updated++;
        } else {
          await client.query(
            `INSERT INTO client_users
               (first_name, last_name, email, phone, department, position, active)
             VALUES ($1,$2,$3,$4,$5,$6,true)`,
            [u.first_name, u.last_name, u.email,
             u.phone, u.department, u.position]
          );
          inserted++;
        }

        await client.query('RELEASE SAVEPOINT sp_user');
      } catch (rowErr) {
        // Revertimos solo este usuario, continuamos con los demás
        try { await client.query('ROLLBACK TO SAVEPOINT sp_user'); } catch (_) {}
        skipped++;
        errors.push(`${u.email}: ${rowErr.message}`);
        console.warn(`  ⚠ Saltado ${u.email}: ${rowErr.message}`);
      }
    }

    // Guarda timestamp de última sync
    await client.query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('ldap_last_sync',$1,NOW())
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
      [JSON.stringify(new Date().toISOString())]
    );

    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }

  return { total: ldapUsers.length, inserted, updated, skipped, errors };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function runSync() {
  console.log('🔄 Iniciando sincronización LDAP...');
  const start = Date.now();
  try {
    const config    = getConfig();
    const ldapUsers = await fetchLdapUsers(config);
    console.log(`   → ${ldapUsers.length} usuarios encontrados en el AD`);
    const result    = await syncToDB(ldapUsers);
    const elapsed   = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`✅ Sync LDAP: +${result.inserted} nuevos, ~${result.updated} actualizados, ${result.skipped} saltados (${elapsed}s)`);
    return { ok: true, ...result, elapsed: parseFloat(elapsed) };
  } catch (err) {
    console.error('❌ Error sync LDAP:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { runSync };
