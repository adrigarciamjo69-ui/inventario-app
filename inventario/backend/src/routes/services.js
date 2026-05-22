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

module.exports = router;
