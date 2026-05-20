const router = require('express').Router();
const { pool } = require('../db');
const { authenticate, requireEditor, requireAdmin } = require('../middleware/auth');

const VALID_LICENSE_TYPES = ['perpetua', 'suscripcion', 'freeware', 'opensource', 'trial', 'volumen'];
const VALID_STATUSES = ['activo', 'inactivo', 'expirado', 'baja'];

// ─── CRUD SOFTWARE ────────────────────────────────────────────────────────────

// GET /api/software
router.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*,
        (SELECT COUNT(*) FROM software_asset_links WHERE software_id = s.id) AS asset_count,
        (SELECT COUNT(*) FROM software_user_links WHERE software_id = s.id) AS user_count
       FROM software s
       ORDER BY s.name ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener software' });
  }
});

// GET /api/software/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM software WHERE id=$1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Software no encontrado' });

    // Cargar vínculos
    const { rows: assetLinks } = await pool.query(
      `SELECT sal.id, sal.software_id, sal.asset_id, sal.notes, sal.assigned_at,
              a.brand AS asset_brand, a.model AS asset_model, a.serial_number AS asset_serial
       FROM software_asset_links sal
       LEFT JOIN assets a ON a.id = sal.asset_id
       WHERE sal.software_id=$1`,
      [req.params.id]
    );
    const { rows: userLinks } = await pool.query(
      `SELECT sul.id, sul.software_id, sul.user_id, sul.notes, sul.assigned_at,
              cu.first_name || ' ' || cu.last_name AS full_name,
              cu.first_name AS username,
              cu.department, cu.position, cu.email
       FROM software_user_links sul
       INNER JOIN client_users cu ON cu.id = sul.user_id
       WHERE sul.software_id=$1
       ORDER BY cu.last_name ASC, cu.first_name ASC, sul.assigned_at ASC`,
      [req.params.id]
    );

    res.json({ ...rows[0], asset_assignments: assetLinks, user_assignments: userLinks });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener el software' });
  }
});

// POST /api/software
router.post('/', authenticate, requireEditor, async (req, res) => {
  const { name, vendor, version, license_key, license_type, seats, purchase_date, expiry_date, purchase_order, price, status, notes } = req.body;
  if (!name || !vendor) {
    return res.status(400).json({ error: 'Nombre y proveedor son requeridos' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO software (name, vendor, version, license_key, license_type, seats, purchase_date, expiry_date, purchase_order, price, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        name.trim(), vendor.trim(), version?.trim() || '',
        license_key?.trim() || null,
        VALID_LICENSE_TYPES.includes(license_type) ? license_type : 'perpetua',
        parseInt(seats) || 1,
        purchase_date || null, expiry_date || null,
        purchase_order?.trim() || null,
        parseFloat(price) || 0,
        VALID_STATUSES.includes(status) ? status : 'activo',
        notes?.trim() || null
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear el software' });
  }
});

// PUT /api/software/:id
router.put('/:id', authenticate, requireEditor, async (req, res) => {
  const { name, vendor, version, license_key, license_type, seats, purchase_date, expiry_date, purchase_order, price, status, notes } = req.body;
  if (!name || !vendor) {
    return res.status(400).json({ error: 'Nombre y proveedor son requeridos' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE software SET
        name=$1, vendor=$2, version=$3, license_key=$4, license_type=$5, seats=$6,
        purchase_date=$7, expiry_date=$8, purchase_order=$9, price=$10, status=$11, notes=$12,
        updated_at=NOW()
       WHERE id=$13 RETURNING *`,
      [
        name.trim(), vendor.trim(), version?.trim() || '',
        license_key?.trim() || null,
        VALID_LICENSE_TYPES.includes(license_type) ? license_type : 'perpetua',
        parseInt(seats) || 1,
        purchase_date || null, expiry_date || null,
        purchase_order?.trim() || null,
        parseFloat(price) || 0,
        VALID_STATUSES.includes(status) ? status : 'activo',
        notes?.trim() || null,
        req.params.id
      ]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Software no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar el software' });
  }
});

// DELETE /api/software/:id
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM software WHERE id=$1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Software no encontrado' });
    res.json({ message: 'Software eliminado correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar el software' });
  }
});

// ─── VÍNCULOS SOFTWARE ↔ ASSETS ────────────────────────────────────────────

// GET /api/software/:id/assets
router.get('/:id/assets', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT sal.id, sal.software_id, sal.asset_id, sal.notes, sal.assigned_at,
              a.brand AS asset_brand, a.model AS asset_model, a.serial_number AS asset_serial
       FROM software_asset_links sal
       LEFT JOIN assets a ON a.id = sal.asset_id
       WHERE sal.software_id=$1 ORDER BY sal.assigned_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener vínculos con activos' });
  }
});

// POST /api/software/:id/assets  — vincular software a un asset
router.post('/:id/assets', authenticate, requireEditor, async (req, res) => {
  const { asset_id, notes } = req.body;
  if (!asset_id) return res.status(400).json({ error: 'asset_id es requerido' });
  try {
    // Verificar que el asset existe
    const assetCheck = await pool.query('SELECT id FROM assets WHERE id=$1', [asset_id]);
    if (assetCheck.rows.length === 0) return res.status(404).json({ error: 'Activo no encontrado' });
    // Verificar que no existe ya el vínculo
    const existing = await pool.query(
      'SELECT id FROM software_asset_links WHERE software_id=$1 AND asset_id=$2',
      [req.params.id, asset_id]
    );
    if (existing.rows.length > 0) return res.status(409).json({ error: 'Este software ya está vinculado a ese activo' });

    const { rows } = await pool.query(
      `INSERT INTO software_asset_links (software_id, asset_id, notes) VALUES ($1,$2,$3)
       RETURNING *`,
      [req.params.id, asset_id, notes?.trim() || null]
    );
    // Devolver con info del asset
    const { rows: full } = await pool.query(
      `SELECT sal.*, a.brand AS asset_brand, a.model AS asset_model, a.serial_number AS asset_serial
       FROM software_asset_links sal LEFT JOIN assets a ON a.id=sal.asset_id WHERE sal.id=$1`,
      [rows[0].id]
    );
    res.status(201).json(full[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al vincular software con activo' });
  }
});

// DELETE /api/software/asset-link/:linkId — desvincular
router.delete('/asset-link/:linkId', authenticate, requireEditor, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM software_asset_links WHERE id=$1', [req.params.linkId]);
    if (rowCount === 0) return res.status(404).json({ error: 'Vínculo no encontrado' });
    res.json({ message: 'Vínculo eliminado' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar vínculo' });
  }
});

// ─── VÍNCULOS SOFTWARE ↔ USUARIOS ──────────────────────────────────────────

// GET /api/software/:id/users — devuelve vínculos con usuarios CLIENTES (incluye múltiples puestos por usuario)
router.get('/:id/users', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT sul.id, sul.software_id, sul.user_id, sul.notes, sul.assigned_at,
              cu.first_name || ' ' || cu.last_name AS full_name,
              cu.first_name AS username,
              cu.department, cu.position, cu.email
       FROM software_user_links sul
       INNER JOIN client_users cu ON cu.id = sul.user_id
       WHERE sul.software_id=$1
       ORDER BY cu.last_name ASC, cu.first_name ASC, sul.assigned_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener vínculos con usuarios' });
  }
});

// POST /api/software/:id/users  — vincular software a un usuario CLIENTE (permite múltiples puestos)
router.post('/:id/users', authenticate, requireEditor, async (req, res) => {
  const client_user_id = req.body.client_user_id || req.body.user_id;
  const { notes } = req.body;
  if (!client_user_id) return res.status(400).json({ error: 'client_user_id es requerido' });
  try {
    // Verificar que el software existe y obtener número de puestos
    const swCheck = await pool.query('SELECT id, seats FROM software WHERE id=$1', [req.params.id]);
    if (swCheck.rows.length === 0) return res.status(404).json({ error: 'Software no encontrado' });

    const seats = swCheck.rows[0].seats;

    // Verificar cuántos puestos hay usados actualmente
    const usedCheck = await pool.query(
      'SELECT COUNT(*) FROM software_user_links WHERE software_id=$1',
      [req.params.id]
    );
    const seatsUsed = parseInt(usedCheck.rows[0].count);

    if (seatsUsed >= seats) {
      return res.status(409).json({
        error: `No quedan puestos disponibles. Esta licencia tiene ${seats} puesto${seats !== 1 ? 's' : ''} y todos están ocupados.`
      });
    }

    // Verificar que el usuario cliente existe
    const userCheck = await pool.query(
      'SELECT id, first_name, last_name, department, position FROM client_users WHERE id=$1',
      [client_user_id]
    );
    if (userCheck.rows.length === 0) return res.status(404).json({ error: 'Usuario cliente no encontrado' });

    // Insertar vínculo (permite duplicados — mismo usuario puede tener varios puestos)
    const { rows } = await pool.query(
      `INSERT INTO software_user_links (software_id, user_id, notes) VALUES ($1,$2,$3) RETURNING *`,
      [req.params.id, client_user_id, notes?.trim() || null]
    );

    const cu = userCheck.rows[0];
    res.status(201).json({
      ...rows[0],
      full_name: `${cu.first_name} ${cu.last_name}`,
      username: cu.first_name,
      department: cu.department,
      position: cu.position,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al vincular software con usuario cliente' });
  }
});

// DELETE /api/software/user-link/:linkId
router.delete('/user-link/:linkId', authenticate, requireEditor, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM software_user_links WHERE id=$1', [req.params.linkId]);
    if (rowCount === 0) return res.status(404).json({ error: 'Vínculo no encontrado' });
    res.json({ message: 'Vínculo eliminado' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar vínculo' });
  }
});

module.exports = router;
