/**
 * routes/agents.js - Modo AGENTE (push) para delegaciones inalcanzables.
 *
 * Problema: el escaneo agentless (nmap + WMI/SSH/SNMP en scanner.js) requiere
 * conexion ENTRANTE del servidor central al equipo. En las delegaciones eso no
 * es posible (NAT/firewall/VPN). Solucion: un agente local en cada equipo
 * recoge los MISMOS datos que wmi_query.py y los EMPUJA por HTTPS saliente a
 * este endpoint, que los inyecta en el MISMO pipeline que un escaneo normal
 * (scan_results + asset_system_info + asset_software).
 *
 * Dos tipos de auth en este router:
 *   - /report          -> token de agente (cabecera X-Agent-Token). SIN JWT.
 *   - /  (gestion CRUD) -> JWT admin (igual que routes/scan.js).
 */
const router = require('express').Router();
const crypto = require('crypto');
const { pool } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

const VALID_STATUSES = ['activo', 'inactivo', 'reparacion', 'baja'];

function sha256(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
}

// ───────────────────────────────────────── Gestion de agentes (admin) ────

// GET /api/agents  -> lista de agentes (sin token, solo metadatos)
router.get('/', authenticate, requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.name, a.delegation, a.os, a.enabled, a.last_seen_at,
              a.created_at, n.name AS network_name, n.cidr
         FROM scan_agents a
         LEFT JOIN scan_networks n ON n.id = a.network_id
        ORDER BY a.name ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener los agentes' });
  }
});

// POST /api/agents  -> da de alta un agente y DEVUELVE EL TOKEN UNA SOLA VEZ.
// body: { name, delegation, cidr? }
router.post('/', authenticate, requireAdmin, async (req, res) => {
  const { name, delegation, cidr } = req.body;
  if (!name) return res.status(400).json({ error: 'name es obligatorio' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Cada delegacion se modela como una scan_network virtual, asi reaprovechamos
    // toda la UI de Descubrimiento sin cambios. El CIDR es informativo.
    const net = await client.query(
      `INSERT INTO scan_networks (name, cidr, enabled, notes)
       VALUES ($1, $2, true, 'Red gestionada por agente (push)')
       RETURNING id`,
      [delegation?.trim() || name.trim(), (cidr && String(cidr).trim()) || '0.0.0.0/32']
    );
    const networkId = net.rows[0].id;

    const token = crypto.randomBytes(32).toString('hex'); // 64 hex chars
    const { rows } = await client.query(
      `INSERT INTO scan_agents (name, delegation, network_id, token_hash, enabled)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, name, delegation, network_id, enabled, created_at`,
      [name.trim(), delegation?.trim() || null, networkId, sha256(token)]
    );
    await client.query('COMMIT');
    // El token en claro SOLO se devuelve aqui. Guardalo en el equipo.
    res.status(201).json({ ...rows[0], token });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al crear el agente' });
  } finally {
    client.release();
  }
});

// POST /api/agents/:id/rotate-token  -> genera un token nuevo (invalida el viejo)
router.post('/:id/rotate-token', authenticate, requireAdmin, async (req, res) => {
  try {
    const token = crypto.randomBytes(32).toString('hex');
    const { rowCount } = await pool.query(
      'UPDATE scan_agents SET token_hash=$1 WHERE id=$2',
      [sha256(token), req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Agente no encontrado' });
    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al rotar el token' });
  }
});

// PUT /api/agents/:id  -> editar nombre/delegacion/estado (activar-desactivar)
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  const { name, delegation, enabled } = req.body;
  const sets = [];
  const vals = [];
  let i = 1;
  if (name !== undefined)       { sets.push(`name=$${i++}`);       vals.push(String(name).trim()); }
  if (delegation !== undefined) { sets.push(`delegation=$${i++}`); vals.push(delegation ? String(delegation).trim() : null); }
  if (enabled !== undefined)    { sets.push(`enabled=$${i++}`);    vals.push(!!enabled); }
  if (sets.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
  vals.push(req.params.id);
  try {
    const { rows, rowCount } = await pool.query(
      `UPDATE scan_agents SET ${sets.join(', ')} WHERE id=$${i}
       RETURNING id, name, delegation, os, enabled, last_seen_at, created_at`,
      vals
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Agente no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar el agente' });
  }
});

// DELETE /api/agents/:id
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM scan_agents WHERE id=$1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Agente no encontrado' });
    res.json({ message: 'Agente eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar el agente' });
  }
});

// ─────────────────────────────────────────── Ingesta de informes (push) ────

// Middleware: autentica por token de agente (cabecera X-Agent-Token).
async function authenticateAgent(req, res, next) {
  const token = req.get('X-Agent-Token') || (req.body && req.body.token);
  if (!token) return res.status(401).json({ error: 'Falta X-Agent-Token' });
  try {
    const { rows } = await pool.query(
      'SELECT * FROM scan_agents WHERE token_hash=$1 AND enabled=true LIMIT 1',
      [sha256(token)]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'Token de agente invalido' });
    req.agent = rows[0];
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error de autenticacion del agente' });
  }
}

// Normaliza el cuerpo del informe del agente al MISMO shape que produce
// scanner.buildResult(): los campos planos + system_info + software.
function normalizeReport(body) {
  const si = body.system_info || {};
  const hw = si.hardware || {};
  const osi = si.os || {};
  const net = Array.isArray(si.network) ? si.network : [];
  const primaryNet = net[0] || {};
  const osStr = body.os || [osi.name, osi.version, osi.build].filter(Boolean).join(' ').trim() || null;
  return {
    ip: body.ip || primaryNet.ip || null,
    mac: body.mac || primaryNet.mac || null,
    hostname: body.hostname || null,
    vendor: body.vendor || hw.manufacturer || null,
    os: osStr,
    open_ports: body.open_ports || null,
    serial_number: body.serial || body.serial_number || null,
    brand: body.vendor || hw.manufacturer || null,
    model: body.model || hw.model || null,
    category: body.category || null, // se infiere abajo si falta
    enrich_method: 'agent',
    system_info: Object.keys(si).length ? si : null,
    software: Array.isArray(body.software) ? body.software : null,
  };
}

// Heuristica minima de categoria (el agente conoce su propio SO).
function guessCategory(r) {
  const os = (r.os || '').toLowerCase();
  const model = (r.model || '').toLowerCase();
  if (/windows\s+server/.test(os)) return 'server';
  if (/linux|unix|bsd/.test(os) && !/laptop|notebook/.test(model)) return 'server';
  if (/probook|elitebook|thinkpad|latitude|laptop|notebook|portatil|macbook/.test(model)) return 'laptop';
  if (/optiplex|elitedesk|prodesk|thinkcentre|desktop|tower|imac/.test(model)) return 'desktop';
  if (/windows/.test(os)) return 'desktop';
  return 'other';
}

// POST /api/agents/report  -> recibe un informe y lo inyecta en el pipeline.
// Crea un scan_job de un solo host bajo la red virtual de la delegacion y
// reaprovecha exactamente la misma logica de scan.js/scheduler.js.
router.post('/report', authenticateAgent, async (req, res) => {
  const agent = req.agent;
  const r = normalizeReport(req.body || {});
  if (!r.category) r.category = guessCategory(r);
  if (!r.serial_number && !r.hostname) {
    return res.status(400).json({ error: 'El informe necesita al menos serial o hostname' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 1) Job de un solo host (trazabilidad + aparece en la pagina de Jobs).
    const job = await client.query(
      `INSERT INTO scan_jobs (network_id, status, started_at, finished_at, hosts_found, agent_id)
       VALUES ($1, 'completed', NOW(), NOW(), 1, $2) RETURNING id`,
      [agent.network_id, agent.id]
    );
    const jobId = job.rows[0].id;

    // 2) Dedup por numero de serie (igual que runJob en scan.js).
    let matched = null;
    if (r.serial_number) {
      const m = await client.query(
        'SELECT id FROM assets WHERE LOWER(TRIM(serial_number)) = LOWER(TRIM($1)) LIMIT 1',
        [r.serial_number]
      );
      if (m.rows.length) matched = m.rows[0].id;
    }

    // 3) Inserta el resultado (mismo formato que un escaneo de red).
    await client.query(
      `INSERT INTO scan_results
         (job_id, ip, mac, hostname, vendor, os, open_ports, serial_number, brand, model,
          category, enrich_method, raw, matched_asset_id, system_info, software)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        jobId, r.ip, r.mac, r.hostname, r.vendor, r.os, r.open_ports,
        r.serial_number, r.brand, r.model, r.category, r.enrich_method,
        JSON.stringify({ source: 'agent', agent_id: agent.id, agent_name: agent.name }),
        matched,
        r.system_info ? JSON.stringify(r.system_info) : null,
        Array.isArray(r.software) ? JSON.stringify(r.software) : null,
      ]
    );

    // 4) Si ya esta inventariado, refresca system_info / software (preserva notas).
    if (matched && r.system_info) {
      await client.query(
        `INSERT INTO asset_system_info (asset_id, scanned_data, scanned_at, source, updated_at)
         VALUES ($1, $2, NOW(), 'agent', NOW())
         ON CONFLICT (asset_id) DO UPDATE SET
           scanned_data = EXCLUDED.scanned_data, scanned_at = EXCLUDED.scanned_at,
           source = EXCLUDED.source, updated_at = NOW()`,
        [matched, JSON.stringify(r.system_info)]
      );
    }
    if (matched && Array.isArray(r.software) && r.software.length) {
      await client.query(
        `INSERT INTO asset_software (asset_id, software, scanned_at, source, updated_at)
         VALUES ($1, $2, NOW(), 'agent', NOW())
         ON CONFLICT (asset_id) DO UPDATE SET
           software = EXCLUDED.software, scanned_at = EXCLUDED.scanned_at,
           source = EXCLUDED.source, updated_at = NOW()`,
        [matched, JSON.stringify(r.software)]
      );
    }

    await client.query('UPDATE scan_agents SET last_seen_at=NOW() WHERE id=$1', [agent.id]);
    await client.query('COMMIT');
    res.status(202).json({ ok: true, matched_asset_id: matched, job_id: jobId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error ingiriendo informe de agente', err);
    res.status(500).json({ error: 'Error al procesar el informe' });
  } finally {
    client.release();
  }
});

module.exports = router;
