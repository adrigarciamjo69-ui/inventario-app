/**
 * routes/ldap.js
 * Endpoints para configuración y sincronización manual del AD
 */

const router      = require('express').Router();
const { pool }    = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { runSync } = require('../ldap-sync');

// GET /api/ldap/status — estado actual + última sync
router.get('/status', authenticate, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT key, value FROM app_settings WHERE key IN ('ldap_last_sync', 'ldap_config')`
    );
    const map = {};
    rows.forEach(r => {
      try { map[r.key] = JSON.parse(r.value); } catch { map[r.key] = r.value; }
    });

    // Count synced users (those with an email matching AD pattern)
    const { rows: countRows } = await pool.query(
      'SELECT COUNT(*) AS total FROM client_users WHERE active = true'
    );

    res.json({
      configured:  !!(map.ldap_config?.url),
      last_sync:   map.ldap_last_sync || null,
      config:      map.ldap_config ? {
        url:     map.ldap_config.url,
        base_dn: map.ldap_config.base_dn,
        bind_dn: map.ldap_config.bind_dn,
        filter:  map.ldap_config.filter,
        // never send password
      } : null,
      total_users: parseInt(countRows[0].total),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener estado LDAP' });
  }
});

// POST /api/ldap/config — save LDAP config (stores in app_settings AND sets env vars)
router.post('/config', authenticate, requireAdmin, async (req, res) => {
  const { url, bind_dn, bind_pass, base_dn, filter } = req.body;
  if (!url || !bind_dn || !bind_pass || !base_dn)
    return res.status(400).json({ error: 'url, bind_dn, bind_pass y base_dn son obligatorios' });

  try {
    const config = { url, bind_dn, bind_pass, base_dn, filter: filter || '' };
    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('ldap_config', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(config)]
    );

    // Apply to current process env so next sync uses new values
    process.env.LDAP_URL        = url;
    process.env.LDAP_BIND_DN    = bind_dn;
    process.env.LDAP_BIND_PASS  = bind_pass;
    process.env.LDAP_BASE_DN    = base_dn;
    if (filter) process.env.LDAP_FILTER = filter;

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar configuración' });
  }
});

// POST /api/ldap/sync — manual sync trigger
router.post('/sync', authenticate, requireAdmin, async (req, res) => {
  // Load config from DB if env vars not set
  try {
    const { rows } = await pool.query(
      `SELECT value FROM app_settings WHERE key = 'ldap_config'`
    );
    if (rows.length > 0) {
      const cfg = JSON.parse(rows[0].value);
      if (!process.env.LDAP_URL)       process.env.LDAP_URL       = cfg.url;
      if (!process.env.LDAP_BIND_DN)   process.env.LDAP_BIND_DN   = cfg.bind_dn;
      if (!process.env.LDAP_BIND_PASS) process.env.LDAP_BIND_PASS = cfg.bind_pass;
      if (!process.env.LDAP_BASE_DN)   process.env.LDAP_BASE_DN   = cfg.base_dn;
      if (cfg.filter && !process.env.LDAP_FILTER) process.env.LDAP_FILTER = cfg.filter;
    }
  } catch (_) {}

  const result = await runSync();
  if (!result.ok) return res.json({ ok: false, error: result.error });
  res.json(result);
});

// POST /api/ldap/test — test connection without syncing
router.post('/test', authenticate, requireAdmin, async (req, res) => {
  const ldap = require('ldapjs');
  const { url, bind_dn, bind_pass } = req.body;
  if (!url || !bind_dn || !bind_pass)
    return res.status(400).json({ error: 'url, bind_dn y bind_pass son obligatorios' });

  const client = ldap.createClient({
    url, timeout: 8000, connectTimeout: 8000,
    tlsOptions: { rejectUnauthorized: false },
  });

  const timeout = setTimeout(() => {
    client.destroy();
    if (!res.headersSent)
      res.json({ ok: false, error: 'Tiempo de espera agotado (8s). Verifica la URL y el firewall.' });
  }, 9000);

  client.on('error', err => {
    clearTimeout(timeout);
    if (!res.headersSent)
      res.json({ ok: false, error: `Error de conexión: ${err.message}` });
  });

  client.bind(bind_dn, bind_pass, (err) => {
    clearTimeout(timeout);
    client.destroy();
    if (res.headersSent) return;
    if (err) return res.json({ ok: false, error: `Credenciales inválidas: ${err.message}` });
    res.json({ ok: true, message: 'Conexión al Active Directory correcta ✓' });
  });
});

module.exports = router;
