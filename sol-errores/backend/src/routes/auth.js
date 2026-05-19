const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { authenticate, JWT_SECRET } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    console.log(`[LOGIN] Intento de login: username="${username}"`);

    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
    }

    const { rows } = await pool.query(
      'SELECT * FROM users WHERE LOWER(username) = LOWER($1)',
      [username.trim()]
    );

    console.log(`[LOGIN] Usuarios encontrados: ${rows.length}`);

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const user = rows[0];

    if (!user.active) {
      return res.status(401).json({ error: 'Usuario inactivo. Contacte con el administrador' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    console.log(`[LOGIN] Contraseña válida: ${valid}`);

    if (!valid) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    console.log(`[LOGIN] Login exitoso para: ${user.username} (role: ${user.role})`);

    res.json({
      token,
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
      active: user.active,
    });
  } catch (err) {
    console.error('[LOGIN] Error:', err);
    res.status(500).json({ error: 'Error del servidor al procesar el login' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  res.json(req.user);
});

module.exports = router;
