const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// GET /api/users
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, username, full_name, email, role, active, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

// GET /api/users/:id
router.get('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, username, full_name, email, role, active, created_at FROM users WHERE id = $1',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener el usuario' });
  }
});

// POST /api/users
router.post('/', authenticate, requireAdmin, async (req, res) => {
  const { username, full_name, email, role, active, password } = req.body;
  if (!username || !full_name || !email || !password) {
    return res.status(400).json({ error: 'username, full_name, email y password son requeridos' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }
  const validRoles = ['admin', 'editor', 'viewer'];
  if (role && !validRoles.includes(role)) {
    return res.status(400).json({ error: 'Rol no válido' });
  }
  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO users (username, full_name, email, role, active, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, username, full_name, email, role, active, created_at`,
      [
        username.trim().toLowerCase(),
        full_name.trim(),
        email.trim().toLowerCase(),
        role || 'viewer',
        active !== undefined ? active : true,
        hash
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'El nombre de usuario o email ya existe' });
    }
    console.error(err);
    res.status(500).json({ error: 'Error al crear el usuario' });
  }
});

// PUT /api/users/:id
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  const { full_name, email, role, active } = req.body;
  if (!full_name || !email) {
    return res.status(400).json({ error: 'full_name y email son requeridos' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE users SET full_name=$1, email=$2, role=$3, active=$4
       WHERE id=$5
       RETURNING id, username, full_name, email, role, active, created_at`,
      [full_name.trim(), email.trim().toLowerCase(), role || 'viewer', active !== undefined ? active : true, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar el usuario' });
  }
});

// PUT /api/users/:id/password
router.put('/:id/password', authenticate, requireAdmin, async (req, res) => {
  const { new_password } = req.body;
  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }
  try {
    const hash = await bcrypt.hash(new_password, 12);
    const { rowCount } = await pool.query(
      'UPDATE users SET password_hash=$1 WHERE id=$2',
      [hash, req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ message: 'Contraseña actualizada correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al cambiar la contraseña' });
  }
});

// DELETE /api/users/:id
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  if (parseInt(req.params.id) === req.user.id) {
    return res.status(400).json({ error: 'No puedes eliminar tu propio usuario' });
  }
  try {
    const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ message: 'Usuario eliminado correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar el usuario' });
  }
});

module.exports = router;
