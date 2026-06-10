const router = require('express').Router();
const { pool } = require('../db');
const { authenticate, requireEditor } = require('../middleware/auth');

// GET /api/settings
router.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT key, value FROM app_settings');
    const result = {};
    rows.forEach(r => {
      try { result[r.key] = JSON.parse(r.value); }
      catch { result[r.key] = r.value; }
    });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener configuración' });
  }
});

// POST /api/settings  — upsert one or many keys
router.post('/', authenticate, requireEditor, async (req, res) => {
  const settings = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [key, value] of Object.entries(settings)) {
      await client.query(`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
      `, [key, JSON.stringify(value)]);
    }
    await client.query('COMMIT');
    res.json({ message: 'Configuración guardada' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al guardar configuración' });
  } finally {
    client.release();
  }
});

module.exports = router;
