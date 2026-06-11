const router = require('express').Router();
const { pool } = require('../db');
const { authenticate, requireAdmin, requireEditor } = require('../middleware/auth');

// GET /api/categories
router.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM categories ORDER BY label ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener categorías' });
  }
});

// POST /api/categories
router.post('/', authenticate, requireAdmin, async (req, res) => {
  const { value, label, icon } = req.body;
  if (!value || !label) {
    return res.status(400).json({ error: 'value y label son requeridos' });
  }
  const slug = value.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  if (!slug) return res.status(400).json({ error: 'El valor de categoría no es válido' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO categories (value, label, icon) VALUES ($1, $2, $3) RETURNING *`,
      [slug, label.trim(), icon?.trim() || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe una categoría con ese valor' });
    console.error(err);
    res.status(500).json({ error: 'Error al crear la categoría' });
  }
});

// PUT /api/categories/:id
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  const { label, icon } = req.body;
  if (!label) return res.status(400).json({ error: 'label es requerido' });
  try {
    const { rows } = await pool.query(
      `UPDATE categories SET label=$1, icon=$2 WHERE id=$3 RETURNING *`,
      [label.trim(), icon?.trim() || null, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar la categoría' });
  }
});

// DELETE /api/categories/:id
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    // Check if it's a system category (built-in)
    const { rows } = await pool.query('SELECT * FROM categories WHERE id=$1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Categoría no encontrada' });
    if (rows[0].is_system) return res.status(400).json({ error: 'No se puede eliminar una categoría del sistema' });

    // Check if any assets use this category
    const { rows: assetRows } = await pool.query(
      'SELECT COUNT(*) FROM assets WHERE category=$1', [rows[0].value]
    );
    if (parseInt(assetRows[0].count) > 0) {
      return res.status(409).json({ error: `No se puede eliminar: ${assetRows[0].count} activos usan esta categoría` });
    }

    await pool.query('DELETE FROM categories WHERE id=$1', [req.params.id]);
    res.json({ message: 'Categoría eliminada correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar la categoría' });
  }
});

module.exports = router;
