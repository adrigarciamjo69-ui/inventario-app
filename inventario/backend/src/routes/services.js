const router = require('express').Router();
const { pool } = require('../db');
const { authenticate, requireEditor, requireAdmin } = require('../middleware/auth');

const VALID_STATUSES      = ['activo','inactivo','cancelado','pendiente'];
const VALID_BILLING       = ['mensual','anual','unico','gratuito'];

// GET /api/services
router.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM services ORDER BY name ASC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener servicios' });
  }
});

// GET /api/services/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM services WHERE id=$1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Servicio no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener el servicio' });
  }
});

// POST /api/services
router.post('/', authenticate, requireEditor, async (req, res) => {
  const { name, provider, category, url, account, department, cost, billing_cycle, renewal_date, status, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'El nombre es requerido' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO services (name, provider, category, url, account, department, cost, billing_cycle, renewal_date, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        name.trim(),
        provider?.trim() || '',
        category?.trim() || 'otros',
        url?.trim() || null,
        account?.trim() || null,
        department?.trim() || null,
        cost || 0,
        billing_cycle || 'mensual',
        renewal_date || null,
        status || 'activo',
        notes?.trim() || null
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear el servicio' });
  }
});

// PUT /api/services/:id
router.put('/:id', authenticate, requireEditor, async (req, res) => {
  const { name, provider, category, url, account, department, cost, billing_cycle, renewal_date, status, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'El nombre es requerido' });
  try {
    const { rows } = await pool.query(
      `UPDATE services SET
        name=$1, provider=$2, category=$3, url=$4, account=$5, department=$6,
        cost=$7, billing_cycle=$8, renewal_date=$9, status=$10, notes=$11,
        updated_at=NOW()
       WHERE id=$12 RETURNING *`,
      [
        name.trim(),
        provider?.trim() || '',
        category?.trim() || 'otros',
        url?.trim() || null,
        account?.trim() || null,
        department?.trim() || null,
        cost || 0,
        billing_cycle || 'mensual',
        renewal_date || null,
        status || 'activo',
        notes?.trim() || null,
        req.params.id
      ]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Servicio no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar el servicio' });
  }
});

// DELETE /api/services/:id
router.delete('/:id', authenticate, requireEditor, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM services WHERE id=$1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Servicio no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar el servicio' });
  }
});

// POST /api/services/import
router.post('/import', authenticate, requireEditor, async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: 'No se proporcionaron elementos para importar' });
  const client = await pool.connect();
  let inserted = 0, updated = 0, errors = [];
  const VALID_BILLING = ['mensual','anual','unico','gratuito'];
  const VALID_STATUSES = ['activo','inactivo','cancelado','pendiente'];
  try {
    await client.query('BEGIN');
    for (const s of items) {
      if (!s.name) { errors.push(`Fila inválida (falta name): ${JSON.stringify(s)}`); continue; }
      try {
        const existing = await client.query('SELECT id FROM services WHERE name=$1', [s.name.trim()]);
        if (existing.rows.length > 0) {
          await client.query(
            `UPDATE services SET provider=$1,category=$2,url=$3,account=$4,department=$5,
             cost=$6,billing_cycle=$7,renewal_date=$8,status=$9,notes=$10,updated_at=NOW() WHERE id=$11`,
            [s.provider?.trim()||'', s.category?.trim()||'otros', s.url?.trim()||null,
             s.account?.trim()||null, s.department?.trim()||null, parseFloat(s.cost)||0,
             VALID_BILLING.includes(s.billing_cycle)?s.billing_cycle:'mensual',
             s.renewal_date||null, VALID_STATUSES.includes(s.status)?s.status:'activo',
             s.notes?.trim()||null, existing.rows[0].id]);
          updated++;
        } else {
          await client.query(
            `INSERT INTO services (name,provider,category,url,account,department,cost,billing_cycle,renewal_date,status,notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [s.name.trim(), s.provider?.trim()||'', s.category?.trim()||'otros',
             s.url?.trim()||null, s.account?.trim()||null, s.department?.trim()||null,
             parseFloat(s.cost)||0, VALID_BILLING.includes(s.billing_cycle)?s.billing_cycle:'mensual',
             s.renewal_date||null, VALID_STATUSES.includes(s.status)?s.status:'activo',
             s.notes?.trim()||null]);
          inserted++;
        }
      } catch (rowErr) { errors.push(`Error en ${s.name}: ${rowErr.message}`); }
    }
    await client.query('COMMIT');
    res.json({ inserted, updated, errors });
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: 'Error en la importación' }); }
  finally { client.release(); }
});

module.exports = router;
