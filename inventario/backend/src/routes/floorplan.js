const router = require('express').Router();
const { pool } = require('../db');
const { authenticate, requireEditor } = require('../middleware/auth');

// GET /api/floorplan — obtener todos los elementos del mapa
router.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM floorplan_items ORDER BY floor, created_at ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener el mapa' });
  }
});

// POST /api/floorplan — crear elemento
router.post('/', authenticate, requireEditor, async (req, res) => {
  const { floor, x, y, width, height, type, label, color, asset_serial, notes } = req.body;
  if (floor === undefined || x === undefined || y === undefined) {
    return res.status(400).json({ error: 'floor, x e y son requeridos' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO floorplan_items (floor, x, y, width, height, type, label, color, asset_id, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        floor, x, y,
        width || 120, height || 80,
        type || 'room',
        label || 'Nuevo elemento',
        color || '#3b82f6',
        asset_serial || null,
        notes || null,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear el elemento' });
  }
});

// PUT /api/floorplan/:id — actualizar elemento (posición, tamaño, propiedades)
router.put('/:id', authenticate, requireEditor, async (req, res) => {
  const { x, y, width, height, label, color, asset_serial, notes, type } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE floorplan_items
       SET x=$1, y=$2, width=$3, height=$4, label=$5, color=$6, asset_id=$7, notes=$8, type=$9
       WHERE id=$10 RETURNING *`,
      [x, y, width, height, label, color, asset_serial || null, notes || null, type, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Elemento no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar el elemento' });
  }
});

// DELETE /api/floorplan/:id — eliminar elemento
router.delete('/:id', authenticate, requireEditor, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM floorplan_items WHERE id=$1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Elemento no encontrado' });
    res.json({ message: 'Elemento eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar el elemento' });
  }
});

module.exports = router;
