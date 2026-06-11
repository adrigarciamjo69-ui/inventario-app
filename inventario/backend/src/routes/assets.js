const router = require('express').Router();
const { pool } = require('../db');
const { authenticate, requireEditor, requireAdmin } = require('../middleware/auth');
const { logChange, diffAsset } = require('../audit');

const VALID_STATUSES = ['activo', 'inactivo', 'reparacion', 'baja'];

// GET /api/assets
router.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM assets ORDER BY brand, model'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener activos' });
  }
});

// GET /api/assets/:id  (PK = id interno)
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM assets WHERE id = $1',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Activo no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener el activo' });
  }
});

// POST /api/assets
router.post('/', authenticate, requireEditor, async (req, res) => {
  const { id, serial_number, category, brand, model, price, purchase_date, purchase_order, assigned_to, department, status, notes } = req.body;
  if (!id || !serial_number || !brand || !model) {
    return res.status(400).json({ error: 'ID interno, número de serie, marca y modelo son requeridos' });
  }
  if (status && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Estado no válido' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO assets (id, serial_number, category, brand, model, price, purchase_date, purchase_order, assigned_to, department, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        id.trim(),
        serial_number.trim(),
        category || 'other',
        brand.trim(),
        model.trim(),
        price || 0,
        purchase_date || null,
        purchase_order?.trim() || null,
        assigned_to?.trim() || null,
        department?.trim() || null,
        status || 'activo',
        notes?.trim() || null
      ]
    );
    const newAsset = rows[0];

    // Audit log
    logChange({ assetId: newAsset.id, userId: req.user?.id, userName: req.user?.full_name,
      action: 'created', changes: null });

    // Auto-vincular actas de entrega que referencien este serial_number
    try {
      await pool.query(
        `UPDATE delivery_record_devices SET asset_id = $1
         WHERE serial_number = $2 AND asset_id IS NULL`,
        [newAsset.id, serial_number.trim()]
      );
    } catch (_) { /* non-fatal */ }

    res.status(201).json(newAsset);
  } catch (err) {
    if (err.code === '23505') {
      if (err.constraint && err.constraint.includes('serial')) {
        return res.status(409).json({ error: `Ya existe un activo con el número de serie: ${serial_number}` });
      }
      return res.status(409).json({ error: `Ya existe un activo con el ID interno: ${id}` });
    }
    console.error(err);
    res.status(500).json({ error: 'Error al crear el activo' });
  }
});

// PUT /api/assets/:id
router.put('/:id', authenticate, requireEditor, async (req, res) => {
  const { serial_number, category, brand, model, price, purchase_date, purchase_order, assigned_to, department, status, notes } = req.body;
  if (!serial_number || !brand || !model) {
    return res.status(400).json({ error: 'Número de serie, marca y modelo son requeridos' });
  }
  try {
    // Fetch old values for diff
    const { rows: oldRows } = await pool.query('SELECT * FROM assets WHERE id=$1', [req.params.id]);
    const oldAsset = oldRows[0] || null;

    const { rows } = await pool.query(
      `UPDATE assets SET
        serial_number=$1, category=$2, brand=$3, model=$4, price=$5,
        purchase_date=$6, purchase_order=$7, assigned_to=$8, department=$9,
        status=$10, notes=$11, updated_at=NOW()
       WHERE id=$12
       RETURNING *`,
      [
        serial_number.trim(),
        category || 'other',
        brand.trim(), model.trim(), price || 0,
        purchase_date || null, purchase_order?.trim() || null,
        assigned_to?.trim() || null, department?.trim() || null,
        status || 'activo', notes?.trim() || null, req.params.id
      ]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Activo no encontrado' });

    // Audit log
    const changes = diffAsset(oldAsset, rows[0]);
    if (changes.length > 0)
      logChange({ assetId: req.params.id, userId: req.user?.id, userName: req.user?.full_name,
        action: 'updated', changes });

    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: `Ya existe un activo con el número de serie: ${serial_number}` });
    }
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar el activo' });
  }
});

// DELETE /api/assets/:id
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { rows: oldRows } = await pool.query('SELECT brand, model, serial_number FROM assets WHERE id=$1', [req.params.id]);
    const { rowCount } = await pool.query('DELETE FROM assets WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Activo no encontrado' });
    if (oldRows[0]) logChange({ assetId: req.params.id, userId: req.user?.id, userName: req.user?.full_name,
      action: 'deleted', changes: [{ label: 'Activo', old: `${oldRows[0].brand} ${oldRows[0].model} (${oldRows[0].serial_number})`, new: null }] });
    res.json({ message: 'Activo eliminado correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar el activo' });
  }
});

// POST /api/assets/import (upsert por id)
router.post('/import', authenticate, requireEditor, async (req, res) => {
  const { assets } = req.body;
  if (!Array.isArray(assets) || assets.length === 0) {
    return res.status(400).json({ error: 'No se proporcionaron activos para importar' });
  }
  const client = await pool.connect();
  let inserted = 0, updated = 0, linked = 0, errors = [];
  try {
    await client.query('BEGIN');
    for (const a of assets) {
      if (!a.id || !a.serial_number || !a.brand || !a.model) {
        errors.push(`Fila inválida (falta id, serial_number, brand o model): ${JSON.stringify(a)}`);
        continue;
      }
      try {
        const result = await client.query(
          `INSERT INTO assets (id, serial_number, category, brand, model, price, purchase_date, purchase_order, assigned_to, department, status, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (id) DO UPDATE SET
             serial_number=EXCLUDED.serial_number,
             category=EXCLUDED.category, brand=EXCLUDED.brand,
             model=EXCLUDED.model, price=EXCLUDED.price,
             purchase_date=EXCLUDED.purchase_date,
             purchase_order=EXCLUDED.purchase_order,
             assigned_to=EXCLUDED.assigned_to,
             department=EXCLUDED.department,
             status=EXCLUDED.status, notes=EXCLUDED.notes,
             updated_at=NOW()
           RETURNING (xmax = 0) AS inserted`,
          [
            a.id?.trim(),
            a.serial_number?.trim(),
            a.category || 'other',
            a.brand?.trim(), a.model?.trim(),
            parseFloat(a.price) || 0,
            a.purchase_date || null,
            a.purchase_order?.trim() || null,
            a.assigned_to?.trim() || null,
            a.department?.trim() || null,
            VALID_STATUSES.includes(a.status) ? a.status : 'activo',
            a.notes?.trim() || null
          ]
        );
        if (result.rows[0].inserted) inserted++;
        else updated++;

        // ── Vinculación automática del usuario cliente ──
        // Se intenta identificar al usuario por employee_id (más fiable) y, si no,
        // por nombre completo exacto. Si se encuentra una única coincidencia, se crea
        // el vínculo "asignado" y los datos del usuario mandan sobre el activo.
        let matchedUser = null;
        if (a.employee_id?.trim()) {
          const r = await client.query(
            `SELECT id, first_name, last_name, department FROM client_users
             WHERE LOWER(TRIM(employee_id)) = LOWER(TRIM($1)) AND active = true LIMIT 1`,
            [a.employee_id.trim()]
          );
          if (r.rows.length === 1) matchedUser = r.rows[0];
        }
        if (!matchedUser && a.assigned_to?.trim()) {
          const r = await client.query(
            `SELECT id, first_name, last_name, department FROM client_users
             WHERE LOWER(TRIM(first_name || ' ' || last_name)) = LOWER(TRIM($1)) AND active = true`,
            [a.assigned_to.trim()]
          );
          if (r.rows.length === 1) matchedUser = r.rows[0];
        }
        if (matchedUser) {
          const linkRes = await client.query(
            `INSERT INTO asset_user_links (asset_id, client_user_id, link_type, assigned_at)
             VALUES ($1, $2, 'asignado', NOW())
             ON CONFLICT (asset_id, client_user_id) DO NOTHING`,
            [a.id.trim(), matchedUser.id]
          );
          if (linkRes.rowCount > 0) linked++;
          // Los datos del usuario vinculado mandan sobre el activo.
          await client.query(
            `UPDATE assets SET assigned_to = $1, department = $2, updated_at = NOW() WHERE id = $3`,
            [
              `${matchedUser.first_name} ${matchedUser.last_name}`.trim(),
              matchedUser.department || null,
              a.id.trim(),
            ]
          );
        }
      } catch (rowErr) {
        errors.push(`Error en ${a.id}: ${rowErr.message}`);
      }
    }
    await client.query('COMMIT');
    res.json({ inserted, updated, linked, errors });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error en la importación' });
  } finally {
    client.release();
  }
});

// ─── VÍNCULOS ASSET ↔ USUARIOS CLIENTES ──────────────────────────────────────

// GET /api/assets/:id/users — obtener usuarios vinculados a un activo
router.get('/:id/users', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT aul.id, aul.asset_id, aul.client_user_id, aul.link_type, aul.notes, aul.assigned_at,
              cu.first_name, cu.last_name, cu.email, cu.department, cu.position, cu.employee_id
       FROM asset_user_links aul
       LEFT JOIN client_users cu ON cu.id = aul.client_user_id
       WHERE aul.asset_id=$1 ORDER BY aul.assigned_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener usuarios del activo' });
  }
});

// POST /api/assets/:id/users — vincular usuario cliente a un activo
router.post('/:id/users', authenticate, requireEditor, async (req, res) => {
  const { client_user_id, link_type, notes } = req.body;
  if (!client_user_id) return res.status(400).json({ error: 'client_user_id es requerido' });
  const validTypes = ['asignado', 'responsable', 'usuario_secundario'];
  const type = validTypes.includes(link_type) ? link_type : 'asignado';
  try {
    const userCheck = await pool.query('SELECT id FROM client_users WHERE id=$1', [client_user_id]);
    if (userCheck.rows.length === 0) return res.status(404).json({ error: 'Usuario cliente no encontrado' });

    const existing = await pool.query(
      'SELECT id FROM asset_user_links WHERE asset_id=$1 AND client_user_id=$2',
      [req.params.id, client_user_id]
    );
    if (existing.rows.length > 0) return res.status(409).json({ error: 'Este usuario ya está vinculado a este activo' });

    const { rows } = await pool.query(
      `INSERT INTO asset_user_links (asset_id, client_user_id, link_type, notes)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, client_user_id, type, notes?.trim() || null]
    );
    const { rows: full } = await pool.query(
      `SELECT aul.*, cu.first_name, cu.last_name, cu.email, cu.department, cu.position, cu.employee_id
       FROM asset_user_links aul LEFT JOIN client_users cu ON cu.id=aul.client_user_id WHERE aul.id=$1`,
      [rows[0].id]
    );
    res.status(201).json(full[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al vincular usuario al activo' });
  }
});

// DELETE /api/assets/user-link/:linkId — desvincular
router.delete('/user-link/:linkId', authenticate, requireEditor, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM asset_user_links WHERE id=$1', [req.params.linkId]);
    if (rowCount === 0) return res.status(404).json({ error: 'Vínculo no encontrado' });
    res.json({ message: 'Vínculo eliminado correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar vínculo' });
  }
});

module.exports = router;


// GET /api/assets/:id/deliveries — actas de entrega vinculadas a este activo
router.get('/:id/deliveries', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT
        dr.id, dr.doc_id, dr.type, dr.delivery_date, dr.status,
        dr.recipient_name, cu.first_name, cu.last_name
      FROM delivery_records dr
      JOIN delivery_record_devices drd ON drd.delivery_record_id = dr.id
      LEFT JOIN client_users cu ON cu.id = dr.client_user_id
      WHERE drd.asset_id = $1
      ORDER BY dr.delivery_date DESC
    `, [req.params.id]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener actas vinculadas' });
  }
});

// POST /api/assets/:id/auto-link-deliveries
// Busca actas con el mismo serial_number y vincula el asset si no está vinculado
router.post('/:id/auto-link-deliveries', authenticate, requireEditor, async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    // Get asset serial number
    const { rows: assetRows } = await client.query(
      'SELECT serial_number FROM assets WHERE id = $1', [id]
    );
    if (!assetRows.length) return res.status(404).json({ error: 'Activo no encontrado' });
    const { serial_number } = assetRows[0];

    // Find delivery_record_devices that match by serial_number but have NULL asset_id
    // OR delivery records that reference this asset_id but aren't yet linked in asset_user_links
    const { rows: pendingRows } = await client.query(`
      SELECT DISTINCT drd.id AS drd_id, dr.id AS dr_id, dr.client_user_id
      FROM delivery_record_devices drd
      JOIN delivery_records dr ON dr.id = drd.delivery_record_id
      WHERE (drd.serial_number = $1 OR drd.asset_id = $2)
        AND drd.asset_id IS NULL
    `, [serial_number, id]);

    // Also update device rows where serial matches but asset_id is null
    const { rowCount: updatedDevices } = await client.query(`
      UPDATE delivery_record_devices
      SET asset_id = $1
      WHERE serial_number = $2 AND asset_id IS NULL
    `, [id, serial_number]);

    // Create asset_user_links for deliveries with a client_user that don't have one yet
    const { rows: linkRows } = await client.query(`
      SELECT DISTINCT dr.client_user_id
      FROM delivery_records dr
      JOIN delivery_record_devices drd ON drd.delivery_record_id = dr.id
      WHERE (drd.asset_id = $1 OR drd.serial_number = $2)
        AND dr.client_user_id IS NOT NULL
        AND dr.type = 'entrega'
        AND NOT EXISTS (
          SELECT 1 FROM asset_user_links aul
          WHERE aul.asset_id = $1 AND aul.client_user_id = dr.client_user_id
        )
    `, [id, serial_number]);

    let linked = 0;
    for (const row of linkRows) {
      await client.query(
        `INSERT INTO asset_user_links (asset_id, client_user_id, link_type, assigned_at)
         VALUES ($1, $2, 'asignado', NOW()) ON CONFLICT DO NOTHING`,
        [id, row.client_user_id]
      );
      linked++;
    }

    res.json({ linked, updated_devices: updatedDevices });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al vincular actas' });
  } finally {
    client.release();
  }
});

// GET /api/assets/:id/log — historial de cambios
router.get('/:id/log', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, user_name, action, changes, created_at
       FROM asset_audit_log
       WHERE asset_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

// GET /api/assets/stats — datos para gráficos de tendencia
router.get('/stats/monthly', authenticate, async (req, res) => {
  try {
    // Activos creados por mes (últimos 12 meses)
    const { rows: created } = await pool.query(`
      SELECT
        TO_CHAR(created_at, 'YYYY-MM') AS month,
        COUNT(*) AS count,
        SUM(price) AS total_value
      FROM assets
      WHERE created_at >= NOW() - INTERVAL '12 months'
      GROUP BY month
      ORDER BY month ASC
    `);

    // Estado actual del inventario
    const { rows: byStatus } = await pool.query(`
      SELECT status, COUNT(*) AS count
      FROM assets
      GROUP BY status
    `);

    // Evolución acumulada de activos (por mes)
    const { rows: cumulative } = await pool.query(`
      SELECT
        TO_CHAR(date_trunc('month', created_at), 'YYYY-MM') AS month,
        COUNT(*) OVER (ORDER BY date_trunc('month', created_at)) AS total
      FROM (
        SELECT DISTINCT date_trunc('month', created_at) AS created_at FROM assets
      ) t
      ORDER BY month
    `);

    // Valor total del inventario por mes (acumulado)
    const { rows: valueByMonth } = await pool.query(`
      SELECT
        TO_CHAR(date_trunc('month', created_at), 'YYYY-MM') AS month,
        SUM(SUM(price)) OVER (ORDER BY date_trunc('month', created_at)) AS cumulative_value
      FROM assets
      GROUP BY date_trunc('month', created_at)
      ORDER BY month
    `);

    // Categorías más comunes
    const { rows: byCategory } = await pool.query(`
      SELECT category, COUNT(*) AS count
      FROM assets
      GROUP BY category
      ORDER BY count DESC
      LIMIT 8
    `);

    // Bajas por mes (últimos 12 meses - via audit log)
    const { rows: retired } = await pool.query(`
      SELECT
        TO_CHAR(created_at, 'YYYY-MM') AS month,
        COUNT(*) AS count
      FROM asset_audit_log
      WHERE action = 'updated'
        AND changes @> '[{"field":"status","new":"baja"}]'
        AND created_at >= NOW() - INTERVAL '12 months'
      GROUP BY month
      ORDER BY month ASC
    `);

    res.json({ created, byStatus, cumulative, valueByMonth, byCategory, retired });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

// ============================================================================
// Resumen del sistema (Info) — se rellena con cada escaneo y permite anadir
// notas manuales que se preservan entre escaneos.
// ============================================================================

// GET /api/assets/:id/info
router.get('/:id/info', authenticate, async (req, res) => {
  try {
    const exists = await pool.query('SELECT 1 FROM assets WHERE id=$1', [req.params.id]);
    if (!exists.rowCount) return res.status(404).json({ error: 'Activo no encontrado' });
    const { rows } = await pool.query(
      `SELECT asset_id, scanned_data, manual_notes, scanned_at, source, updated_at
         FROM asset_system_info WHERE asset_id=$1`,
      [req.params.id]
    );
    if (!rows.length) {
      // Aun no hay info: devolvemos un esqueleto vacio para que el frontend
      // pueda mostrar el textarea de notas manuales sin tratamiento especial.
      return res.json({
        asset_id: req.params.id,
        scanned_data: null,
        manual_notes: '',
        scanned_at: null,
        source: null,
        updated_at: null,
      });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener la info del activo' });
  }
});

// PUT /api/assets/:id/info — actualiza solo las notas manuales (los datos
// escaneados solo se tocan desde el flujo de import/scan).
router.put('/:id/info', authenticate, requireEditor, async (req, res) => {
  try {
    const exists = await pool.query('SELECT 1 FROM assets WHERE id=$1', [req.params.id]);
    if (!exists.rowCount) return res.status(404).json({ error: 'Activo no encontrado' });
    const notes = (req.body && typeof req.body.manual_notes === 'string')
      ? req.body.manual_notes
      : '';
    const { rows } = await pool.query(
      `INSERT INTO asset_system_info (asset_id, manual_notes, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (asset_id) DO UPDATE SET
         manual_notes = EXCLUDED.manual_notes,
         updated_at   = NOW()
       RETURNING asset_id, scanned_data, manual_notes, scanned_at, source, updated_at`,
      [req.params.id, notes]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar la info del activo' });
  }
});
