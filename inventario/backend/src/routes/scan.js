/**
 * routes/scan.js - Configuracion del descubrimiento de red (Fase 1).
 * Gestiona rangos de red (CIDR) y sus credenciales (SSH / SNMP / WinRM).
 * Solo administradores. Los secretos se guardan cifrados y NUNCA se devuelven.
 *
 * Fase 2 (pendiente): motor de escaneo (nmap + enriquecimiento) e importacion.
 */
const router = require('express').Router();
const { pool } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { encrypt } = require('../crypto');
const { scanNetwork } = require('../scanner');

const VALID_TYPES = ['ssh', 'snmp', 'winrm'];
const VALID_STATUSES = ['activo', 'inactivo', 'reparacion', 'baja'];
const DEFAULT_PORTS = { ssh: 22, snmp: 161, winrm: 5985 };
const CIDR_RE = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;

// Devuelve la credencial sin exponer el secreto cifrado.
function maskCred(c) {
  return {
    id: c.id,
    network_id: c.network_id,
    type: c.type,
    label: c.label,
    username: c.username,
    port: c.port,
    priority: c.priority,
    has_secret: !!c.secret_encrypted,
    created_at: c.created_at,
  };
}

function validCidr(cidr) {
  if (!CIDR_RE.test(cidr)) return false;
  const [ip, bits] = cidr.split('/');
  if (parseInt(bits) > 32) return false;
  return ip.split('.').every((o) => parseInt(o) <= 255);
}

// ---------------------------------------------------------------- Redes ----

// GET /api/scan/networks  -> redes con sus credenciales (enmascaradas)
router.get('/networks', authenticate, requireAdmin, async (req, res) => {
  try {
    const { rows: nets } = await pool.query('SELECT * FROM scan_networks ORDER BY name ASC');
    const { rows: creds } = await pool.query(
      'SELECT * FROM scan_credentials ORDER BY priority ASC, id ASC'
    );
    const byNet = {};
    for (const c of creds) {
      (byNet[c.network_id] = byNet[c.network_id] || []).push(maskCred(c));
    }
    res.json(nets.map((n) => ({ ...n, credentials: byNet[n.id] || [] })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener las redes' });
  }
});

// POST /api/scan/networks
router.post('/networks', authenticate, requireAdmin, async (req, res) => {
  const { name, cidr, enabled, notes } = req.body;
  if (!name || !cidr) return res.status(400).json({ error: 'name y cidr son requeridos' });
  if (!validCidr(cidr.trim())) {
    return res.status(400).json({ error: 'CIDR no valido (ej. 192.168.1.0/24)' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO scan_networks (name, cidr, enabled, notes) VALUES ($1,$2,$3,$4) RETURNING *`,
      [name.trim(), cidr.trim(), enabled !== false, notes?.trim() || null]
    );
    res.status(201).json({ ...rows[0], credentials: [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear la red' });
  }
});

// PUT /api/scan/networks/:id
router.put('/networks/:id', authenticate, requireAdmin, async (req, res) => {
  const { name, cidr, enabled, notes } = req.body;
  if (!name || !cidr) return res.status(400).json({ error: 'name y cidr son requeridos' });
  if (!validCidr(cidr.trim())) {
    return res.status(400).json({ error: 'CIDR no valido (ej. 192.168.1.0/24)' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE scan_networks SET name=$1, cidr=$2, enabled=$3, notes=$4 WHERE id=$5 RETURNING *`,
      [name.trim(), cidr.trim(), enabled !== false, notes?.trim() || null, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Red no encontrada' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar la red' });
  }
});

// DELETE /api/scan/networks/:id  (borra en cascada sus credenciales)
router.delete('/networks/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM scan_networks WHERE id=$1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Red no encontrada' });
    res.json({ message: 'Red eliminada correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar la red' });
  }
});

// --------------------------------------------------------- Credenciales ----

// POST /api/scan/networks/:id/credentials
router.post('/networks/:id/credentials', authenticate, requireAdmin, async (req, res) => {
  const { type, label, username, secret, port, priority } = req.body;
  const t = (type || 'ssh').toLowerCase();
  if (!VALID_TYPES.includes(t)) return res.status(400).json({ error: 'Tipo de credencial no valido' });
  try {
    const net = await pool.query('SELECT id FROM scan_networks WHERE id=$1', [req.params.id]);
    if (net.rows.length === 0) return res.status(404).json({ error: 'Red no encontrada' });
    const { rows } = await pool.query(
      `INSERT INTO scan_credentials (network_id, type, label, username, secret_encrypted, port, priority)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        req.params.id,
        t,
        label?.trim() || null,
        username?.trim() || null,
        secret ? encrypt(secret) : null,
        port || DEFAULT_PORTS[t],
        Number.isFinite(priority) ? priority : (parseInt(priority) || 0),
      ]
    );
    res.status(201).json(maskCred(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear la credencial' });
  }
});

// PUT /api/scan/credentials/:id  (re-cifra el secreto solo si llega uno nuevo)
router.put('/credentials/:id', authenticate, requireAdmin, async (req, res) => {
  const { type, label, username, secret, port, priority } = req.body;
  try {
    const cur = await pool.query('SELECT * FROM scan_credentials WHERE id=$1', [req.params.id]);
    if (cur.rows.length === 0) return res.status(404).json({ error: 'Credencial no encontrada' });
    const c = cur.rows[0];
    const t = (type || c.type).toLowerCase();
    if (!VALID_TYPES.includes(t)) return res.status(400).json({ error: 'Tipo de credencial no valido' });
    const newSecret = secret ? encrypt(secret) : c.secret_encrypted;
    const { rows } = await pool.query(
      `UPDATE scan_credentials SET type=$1, label=$2, username=$3, secret_encrypted=$4, port=$5, priority=$6
       WHERE id=$7 RETURNING *`,
      [
        t,
        label !== undefined ? (label?.trim() || null) : c.label,
        username !== undefined ? (username?.trim() || null) : c.username,
        newSecret,
        port != null ? port : c.port,
        priority != null ? (parseInt(priority) || 0) : c.priority,
        req.params.id,
      ]
    );
    res.json(maskCred(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar la credencial' });
  }
});

// DELETE /api/scan/credentials/:id
router.delete('/credentials/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM scan_credentials WHERE id=$1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Credencial no encontrada' });
    res.json({ message: 'Credencial eliminada correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar la credencial' });
  }
});

// ============================================================================
// FASE 2 - Escaneo de red e importacion de activos
// ============================================================================

// Ejecuta el escaneo en segundo plano y vuelca los resultados en la BD.
async function runJob(jobId, network, credentials) {
  try {
    const results = await scanNetwork(network, credentials);
    for (const r of results) {
      // Deduplicacion: intenta casar con un activo existente por numero de serie.
      let matched = null;
      if (r.serial_number) {
        const m = await pool.query(
          'SELECT id FROM assets WHERE LOWER(TRIM(serial_number)) = LOWER(TRIM($1)) LIMIT 1',
          [r.serial_number]
        );
        if (m.rows.length) matched = m.rows[0].id;
      }
      await pool.query(
        `INSERT INTO scan_results
           (job_id, ip, mac, hostname, vendor, os, open_ports, serial_number, brand, model, category, enrich_method, raw, matched_asset_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          jobId, r.ip, r.mac, r.hostname, r.vendor, r.os, r.open_ports,
          r.serial_number, r.brand, r.model, r.category || 'other',
          r.enrich_method, JSON.stringify(r.raw || {}), matched,
        ]
      );
    }
    await pool.query(
      `UPDATE scan_jobs SET status='completed', finished_at=NOW(), hosts_found=$1 WHERE id=$2`,
      [results.length, jobId]
    );
  } catch (err) {
    console.error('Error en el trabajo de escaneo', err);
    await pool.query(
      `UPDATE scan_jobs SET status='failed', finished_at=NOW(), error=$1 WHERE id=$2`,
      [String(err && err.message ? err.message : err).slice(0, 500), jobId]
    );
  }
}

// POST /api/scan/networks/:id/run  -> lanza un escaneo (asincrono)
router.post('/networks/:id/run', authenticate, requireAdmin, async (req, res) => {
  try {
    const netRes = await pool.query('SELECT * FROM scan_networks WHERE id=$1', [req.params.id]);
    if (netRes.rows.length === 0) return res.status(404).json({ error: 'Red no encontrada' });
    const network = netRes.rows[0];

    // Evita escaneos duplicados simultaneos sobre la misma red.
    const running = await pool.query(
      "SELECT id FROM scan_jobs WHERE network_id=$1 AND status='running' LIMIT 1",
      [network.id]
    );
    if (running.rows.length) {
      return res.status(409).json({ error: 'Ya hay un escaneo en curso para esta red' });
    }

    const credRes = await pool.query(
      'SELECT * FROM scan_credentials WHERE network_id=$1 ORDER BY priority ASC, id ASC',
      [network.id]
    );
    const job = await pool.query(
      `INSERT INTO scan_jobs (network_id, status, started_at) VALUES ($1,'running',NOW()) RETURNING *`,
      [network.id]
    );
    const jobRow = job.rows[0];

    // No esperamos: el escaneo corre en segundo plano y se consulta por polling.
    runJob(jobRow.id, network, credRes.rows).catch((e) => console.error('scan job error', e));

    res.status(202).json({ job: jobRow, message: 'Escaneo iniciado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al iniciar el escaneo' });
  }
});

// GET /api/scan/jobs  -> ultimos trabajos con resumen
router.get('/jobs', authenticate, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT j.*, n.name AS network_name, n.cidr,
         (SELECT COUNT(*) FROM scan_results r WHERE r.job_id = j.id) AS result_count,
         (SELECT COUNT(*) FROM scan_results r WHERE r.job_id = j.id AND r.imported) AS imported_count
       FROM scan_jobs j
       LEFT JOIN scan_networks n ON n.id = j.network_id
       ORDER BY j.id DESC LIMIT 50`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener los trabajos de escaneo' });
  }
});

// GET /api/scan/jobs/:id  -> trabajo + resultados
router.get('/jobs/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const j = await pool.query(
      `SELECT j.*, n.name AS network_name, n.cidr
       FROM scan_jobs j LEFT JOIN scan_networks n ON n.id = j.network_id
       WHERE j.id=$1`,
      [req.params.id]
    );
    if (j.rows.length === 0) return res.status(404).json({ error: 'Trabajo no encontrado' });
    const r = await pool.query('SELECT * FROM scan_results WHERE job_id=$1 ORDER BY id ASC', [req.params.id]);
    res.json({ ...j.rows[0], results: r.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener el trabajo' });
  }
});

// DELETE /api/scan/jobs/:id
router.delete('/jobs/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM scan_jobs WHERE id=$1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Trabajo no encontrado' });
    res.json({ message: 'Trabajo eliminado correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar el trabajo' });
  }
});

// POST /api/scan/jobs/:id/import
// body: { items: [{ result_id, id, serial_number, category, brand, model, price, assigned_to, department, status, notes }] }
// Crea/actualiza activos (upsert por id) y marca los resultados como importados.
router.post('/jobs/:id/import', authenticate, requireAdmin, async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'No se seleccionaron equipos para importar' });
  }
  const client = await pool.connect();
  let inserted = 0;
  let updated = 0;
  const errors = [];
  try {
    await client.query('BEGIN');
    for (const a of items) {
      if (!a.id || !a.serial_number || !a.brand || !a.model) {
        errors.push(`Faltan campos obligatorios (ID, serie, marca o modelo) en ${a.ip || a.id || 'equipo'}`);
        continue;
      }
      try {
        const result = await client.query(
          `INSERT INTO assets (id, serial_number, category, brand, model, price, assigned_to, department, status, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (id) DO UPDATE SET
             serial_number=EXCLUDED.serial_number, category=EXCLUDED.category,
             brand=EXCLUDED.brand, model=EXCLUDED.model, price=EXCLUDED.price,
             assigned_to=EXCLUDED.assigned_to, department=EXCLUDED.department,
             status=EXCLUDED.status, notes=EXCLUDED.notes, updated_at=NOW()
           RETURNING (xmax = 0) AS inserted`,
          [
            String(a.id).trim(),
            String(a.serial_number).trim(),
            a.category || 'other',
            String(a.brand).trim(),
            String(a.model).trim(),
            parseFloat(a.price) || 0,
            a.assigned_to?.trim() || null,
            a.department?.trim() || null,
            VALID_STATUSES.includes(a.status) ? a.status : 'activo',
            a.notes?.trim() || null,
          ]
        );
        if (result.rows[0].inserted) inserted++; else updated++;
        if (a.result_id) {
          await client.query(
            'UPDATE scan_results SET imported=true, matched_asset_id=$1 WHERE id=$2',
            [String(a.id).trim(), a.result_id]
          );
        }
      } catch (rowErr) {
        if (rowErr.code === '23505') {
          errors.push(`Numero de serie duplicado: ${a.serial_number}`);
        } else {
          errors.push(`Error en ${a.id}: ${rowErr.message}`);
        }
      }
    }
    await client.query('COMMIT');
    res.json({ inserted, updated, errors });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error en la importacion' });
  } finally {
    client.release();
  }
});

module.exports = router;
