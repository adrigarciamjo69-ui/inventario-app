const router = require('express').Router();
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

const VALID_STATUSES = ['activo', 'inactivo', 'reparacion', 'baja'];

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function generateToken() {
  return `invagt_${crypto.randomBytes(32).toString('base64url')}`;
}

function cleanText(value, max = 500) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const v = cleanText(value);
    if (v) return v;
  }
  return null;
}

function normalizeSoftware(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => ({
      name: firstNonEmpty(x.name, x.display_name, x.DisplayName),
      version: firstNonEmpty(x.version, x.display_version, x.DisplayVersion) || '',
      vendor: firstNonEmpty(x.vendor, x.publisher, x.Publisher) || '',
      install_date: firstNonEmpty(x.install_date, x.InstallDate),
      arch: firstNonEmpty(x.arch, x.architecture),
    }))
    .filter((x) => x.name)
    .slice(0, 5000);
}

function normalizeReport(body, req) {
  const systemInfo = body.system_info && typeof body.system_info === 'object' ? body.system_info : {};
  const osInfo = systemInfo.os && typeof systemInfo.os === 'object' ? systemInfo.os : {};
  const computer = systemInfo.computer && typeof systemInfo.computer === 'object' ? systemInfo.computer : {};
  const bios = systemInfo.bios && typeof systemInfo.bios === 'object' ? systemInfo.bios : {};

  const method = firstNonEmpty(body.enrich_method, body.agent_platform === 'linux' ? 'agent-linux' : null, body.agent_platform === 'windows' ? 'agent-windows' : null) || 'agent';
  const hostname = firstNonEmpty(body.hostname, computer.hostname, computer.name, osInfo.hostname);
  const serial = firstNonEmpty(body.serial_number, body.serial, bios.serial_number, bios.serial);
  const brand = firstNonEmpty(body.brand, body.vendor, computer.manufacturer, bios.manufacturer);
  const model = firstNonEmpty(body.model, computer.model, computer.product_name);
  const os = firstNonEmpty(body.os, osInfo.caption, osInfo.name, osInfo.pretty_name, osInfo.description);

  return {
    agent_id: firstNonEmpty(body.agent_id, body.device_id, hostname, serial),
    agent_version: firstNonEmpty(body.agent_version, body.version),
    delegation: firstNonEmpty(body.delegation, body.site, body.location),
    ip: firstNonEmpty(body.ip, body.ip_address, req.headers['x-forwarded-for']?.split(',')[0], req.socket?.remoteAddress),
    mac: firstNonEmpty(body.mac, body.mac_address),
    hostname,
    vendor: brand,
    os,
    open_ports: firstNonEmpty(body.open_ports) || '',
    serial_number: serial,
    brand,
    model,
    category: firstNonEmpty(body.category) || (/server/i.test(os || '') ? 'server' : 'other'),
    enrich_method: method.slice(0, 20),
    system_info: Object.keys(systemInfo).length ? systemInfo : body,
    software: normalizeSoftware(body.software),
    raw: body,
  };
}

async function authenticateAgent(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.headers['x-agent-token'] || req.body?.token);
  if (!token) return res.status(401).json({ error: 'Token de agente no proporcionado' });

  try {
    const { rows } = await pool.query(
      `SELECT * FROM agent_tokens WHERE token_hash=$1 AND enabled=true LIMIT 1`,
      [sha256(token)]
    );
    if (!rows.length) return res.status(401).json({ error: 'Token de agente invalido o deshabilitado' });
    req.agentToken = rows[0];
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error autenticando agente' });
  }
}

async function persistReport(agentToken, report) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let matched = null;
    if (report.serial_number) {
      const m = await client.query(
        'SELECT id FROM assets WHERE LOWER(TRIM(serial_number)) = LOWER(TRIM($1)) LIMIT 1',
        [report.serial_number]
      );
      if (m.rows.length) matched = m.rows[0].id;
    }

    const job = await client.query(
      `INSERT INTO scan_jobs (network_id, status, hosts_found, started_at, finished_at)
       VALUES (NULL, 'completed', 1, NOW(), NOW()) RETURNING *`
    );
    const jobId = job.rows[0].id;

    const sr = await client.query(
      `INSERT INTO scan_results
         (job_id, ip, mac, hostname, vendor, os, open_ports, serial_number, brand, model, category, enrich_method, raw, matched_asset_id, system_info, software, imported)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        jobId, report.ip, report.mac, report.hostname, report.vendor, report.os, report.open_ports,
        report.serial_number, report.brand, report.model, report.category || 'other', report.enrich_method,
        JSON.stringify({ agent_token_id: agentToken.id, report: report.raw || {} }), matched,
        JSON.stringify(report.system_info || {}), JSON.stringify(report.software || []), !!matched,
      ]
    );

    let assetId = matched;
    let createdAsset = false;
    if (!assetId && agentToken.auto_import && report.serial_number && report.brand && report.model) {
      assetId = cleanText(report.agent_id, 45) || cleanText(report.hostname, 45) || uuidv4().slice(0, 8);
      assetId = assetId.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 45);
      const inserted = await client.query(
        `INSERT INTO assets (id, serial_number, category, brand, model, status, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET
           serial_number=EXCLUDED.serial_number,
           category=EXCLUDED.category,
           brand=EXCLUDED.brand,
           model=EXCLUDED.model,
           updated_at=NOW()
         RETURNING (xmax = 0) AS inserted`,
        [assetId, report.serial_number, report.category || 'other', report.brand, report.model, 'activo', `Alta automatica por agente ${agentToken.name || agentToken.id}`]
      );
      createdAsset = !!inserted.rows[0]?.inserted;
      await client.query('UPDATE scan_results SET imported=true, matched_asset_id=$1 WHERE id=$2', [assetId, sr.rows[0].id]);
    }

    if (assetId && report.system_info) {
      await client.query(
        `INSERT INTO asset_system_info (asset_id, scanned_data, scanned_at, source, updated_at)
         VALUES ($1, $2, NOW(), $3, NOW())
         ON CONFLICT (asset_id) DO UPDATE SET
           scanned_data = EXCLUDED.scanned_data,
           scanned_at = EXCLUDED.scanned_at,
           source = EXCLUDED.source,
           updated_at = NOW()`,
        [assetId, JSON.stringify(report.system_info), report.enrich_method]
      );
    }

    if (assetId && Array.isArray(report.software)) {
      await client.query(
        `INSERT INTO asset_software (asset_id, software, scanned_at, source, updated_at)
         VALUES ($1, $2, NOW(), $3, NOW())
         ON CONFLICT (asset_id) DO UPDATE SET
           software = EXCLUDED.software,
           scanned_at = EXCLUDED.scanned_at,
           source = EXCLUDED.source,
           updated_at = NOW()`,
        [assetId, JSON.stringify(report.software), report.enrich_method]
      );
    }

    await client.query(
      `UPDATE agent_tokens SET
         last_seen=NOW(), last_report_at=NOW(), last_hostname=$1, last_ip=$2, last_os=$3,
         agent_version=$4, delegation=COALESCE($5, delegation), updated_at=NOW()
       WHERE id=$6`,
      [report.hostname, report.ip, report.os, report.agent_version, report.delegation, agentToken.id]
    );

    await client.query('COMMIT');
    return { job_id: jobId, result_id: sr.rows[0].id, matched_asset_id: assetId, created_asset: createdAsset };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Endpoint publico usado por los agentes instalados.
router.post('/report', authenticateAgent, async (req, res) => {
  try {
    const report = normalizeReport(req.body || {}, req);
    if (!report.hostname && !report.serial_number && !report.agent_id) {
      return res.status(400).json({ error: 'Reporte invalido: falta hostname, serial_number o agent_id' });
    }
    const saved = await persistReport(req.agentToken, report);
    res.status(202).json({ ok: true, ...saved });
  } catch (err) {
    console.error('[agents/report]', err);
    res.status(500).json({ error: 'Error guardando reporte de agente' });
  }
});

// Administracion de agentes/tokens.
router.get('/', authenticate, requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, delegation, enabled, auto_import, notes, created_at, updated_at,
              last_seen, last_report_at, last_hostname, last_ip, last_os, agent_version
       FROM agent_tokens
       ORDER BY COALESCE(last_seen, created_at) DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo agentes' });
  }
});

router.post('/tokens', authenticate, requireAdmin, async (req, res) => {
  try {
    const token = generateToken();
    const { name, delegation, notes, auto_import } = req.body || {};
    const { rows } = await pool.query(
      `INSERT INTO agent_tokens (name, delegation, notes, auto_import, token_hash)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, name, delegation, enabled, auto_import, notes, created_at`,
      [cleanText(name, 120) || 'Agente sin nombre', cleanText(delegation, 120), cleanText(notes, 1000), !!auto_import, sha256(token)]
    );
    res.status(201).json({ ...rows[0], token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error creando token de agente' });
  }
});

router.put('/tokens/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, delegation, notes, enabled, auto_import } = req.body || {};
    const { rows } = await pool.query(
      `UPDATE agent_tokens SET
         name=$1, delegation=$2, notes=$3, enabled=$4, auto_import=$5, updated_at=NOW()
       WHERE id=$6
       RETURNING id, name, delegation, enabled, auto_import, notes, created_at, updated_at, last_seen, last_report_at, last_hostname, last_ip, last_os, agent_version`,
      [cleanText(name, 120) || 'Agente sin nombre', cleanText(delegation, 120), cleanText(notes, 1000), enabled !== false, !!auto_import, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Agente no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error actualizando agente' });
  }
});

router.post('/tokens/:id/regenerate', authenticate, requireAdmin, async (req, res) => {
  try {
    const token = generateToken();
    const { rows } = await pool.query(
      `UPDATE agent_tokens SET token_hash=$1, updated_at=NOW() WHERE id=$2
       RETURNING id, name, delegation, enabled, auto_import, notes, created_at, updated_at`,
      [sha256(token), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Agente no encontrado' });
    res.json({ ...rows[0], token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error regenerando token' });
  }
});

router.delete('/tokens/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM agent_tokens WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Agente no encontrado' });
    res.json({ message: 'Agente eliminado correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error eliminando agente' });
  }
});

router.get('/reports', authenticate, requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*, j.created_at AS job_created_at
       FROM scan_results r
       JOIN scan_jobs j ON j.id = r.job_id
       WHERE r.enrich_method LIKE 'agent%'
       ORDER BY r.created_at DESC
       LIMIT 200`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo reportes de agentes' });
  }
});

module.exports = router;
