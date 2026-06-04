const router = require('express').Router();
const { pool } = require('../db');
const { authenticate, requireEditor, requireAdmin } = require('../middleware/auth');

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
  const { id, serial_number, category, brand, model, price, purchase_date, purchase_order, assigned_to, status, notes } = req.body;
  if (!id || !serial_number || !brand || !model) {
    return res.status(400).json({ error: 'ID interno, número de serie, marca y modelo son requeridos' });
  }
  if (status && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Estado no válido' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO assets (id, serial_number, category, brand, model, price, purchase_date, purchase_order, assigned_to, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
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
        status || 'activo',
        notes?.trim() || null
      ]
    );
    const newAsset = rows[0];

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
  const { serial_number, category, brand, model, price, purchase_date, purchase_order, assigned_to, status, notes } = req.body;
  if (!serial_number || !brand || !model) {
    return res.status(400).json({ error: 'Número de serie, marca y modelo son requeridos' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE assets SET
        serial_number=$1, category=$2, brand=$3, model=$4, price=$5,
        purchase_date=$6, purchase_order=$7, assigned_to=$8,
        status=$9, notes=$10, updated_at=NOW()
       WHERE id=$11
       RETURNING *`,
      [
        serial_number.trim(),
        category || 'other',
        brand.trim(), model.trim(), price || 0,
        purchase_date || null, purchase_order?.trim() || null,
        assigned_to?.trim() || null, status || 'activo',
        notes?.trim() || null, req.params.id
      ]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Activo no encontrado' });
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
    const { rowCount } = await pool.query(
      'DELETE FROM assets WHERE id = $1',
      [req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Activo no encontrado' });
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
  let inserted = 0, updated = 0, errors = [];
  try {
    await client.query('BEGIN');
    for (const a of assets) {
      if (!a.id || !a.serial_number || !a.brand || !a.model) {
        errors.push(`Fila inválida (falta id, serial_number, brand o model): ${JSON.stringify(a)}`);
        continue;
      }
      try {
        const result = await client.query(
          `INSERT INTO assets (id, serial_number, category, brand, model, price, purchase_date, purchase_order, assigned_to, status, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (id) DO UPDATE SET
             serial_number=EXCLUDED.serial_number,
             category=EXCLUDED.category, brand=EXCLUDED.brand,
             model=EXCLUDED.model, price=EXCLUDED.price,
             purchase_date=EXCLUDED.purchase_date,
             purchase_order=EXCLUDED.purchase_order,
             assigned_to=EXCLUDED.assigned_to,
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
            VALID_STATUSES.includes(a.status) ? a.status : 'activo',
            a.notes?.trim() || null
          ]
        );
        if (result.rows[0].inserted) inserted++;
        else updated++;
      } catch (rowErr) {
        errors.push(`Error en ${a.id}: ${rowErr.message}`);
      }
    }
    await client.query('COMMIT');
    res.json({ inserted, updated, errors });
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
