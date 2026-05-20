const jwt = require('jsonwebtoken');
const { pool } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'inventarioit_secret_change_in_production';

const authenticate = async (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }
  const token = auth.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const { rows } = await pool.query(
      'SELECT id, username, full_name, email, role, active FROM users WHERE id = $1 AND active = true',
      [payload.id]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'Usuario no encontrado o inactivo' });
    req.user = rows[0];
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Se requieren permisos de administrador' });
  }
  next();
};

const requireEditor = (req, res, next) => {
  if (req.user.role === 'viewer') {
    return res.status(403).json({ error: 'Se requieren permisos de editor o superior' });
  }
  next();
};

module.exports = { authenticate, requireAdmin, requireEditor, JWT_SECRET };
