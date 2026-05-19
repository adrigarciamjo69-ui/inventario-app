/**
 * Rutas para gestionar usuarios clientes (personas asignables a assets/software)
 * Son distintos de los usuarios de la app (tabla users).
 * Tabla: client_users
 */

const router = require('express').Router();
const { pool } = require('../db');
const { authenticate, requireAdmin, requireEditor } = require('../middleware/auth');

// GET /api/client-users
router.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM client_users ORDER BY last_name, first_name`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener usuarios clientes' });
  }
});

// GET /api/client-users/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM client_users WHERE id=$1',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Usuario cliente no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener usuario cliente' });
  }
});

// POST /api/client-users
router.post('/', authenticate, requireEditor, async (req, res) => {
  const { first_name, last_name, email, phone, department, position, employee_id, notes, active } = req.body;
  if (!first_name || !last_name) {
    return res.status(400).json({ error: 'Nombre y apellidos son requeridos' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO client_users (first_name, last_name, email, phone, department, position, employee_id, notes, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        first_name.trim(),
        last_name.trim(),
        email?.trim().toLowerCase() || null,
        phone?.trim() || null,
        department?.trim() || null,
        position?.trim() || null,
        employee_id?.trim() || null,
        notes?.trim() || null,
        active !== undefined ? active : true,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un usuario con ese email o ID de empleado' });
    }
    console.error(err);
    res.status(500).json({ error: 'Error al crear usuario cliente' });
  }
});

// PUT /api/client-users/:id
router.put('/:id', authenticate, requireEditor, async (req, res) => {
  const { first_name, last_name, email, phone, department, position, employee_id, notes, active } = req.body;
  if (!first_name || !last_name) {
    return res.status(400).json({ error: 'Nombre y apellidos son requeridos' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE client_users SET
        first_name=$1, last_name=$2, email=$3, phone=$4, department=$5,
        position=$6, employee_id=$7, notes=$8, active=$9, updated_at=NOW()
       WHERE id=$10 RETURNING *`,
      [
        first_name.trim(),
        last_name.trim(),
        email?.trim().toLowerCase() || null,
        phone?.trim() || null,
        department?.trim() || null,
        position?.trim() || null,
        employee_id?.trim() || null,
        notes?.trim() || null,
        active !== undefined ? active : true,
        req.params.id,
      ]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Usuario cliente no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un usuario con ese email o ID de empleado' });
    }
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar usuario cliente' });
  }
});

// DELETE /api/client-users/:id
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM client_users WHERE id=$1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Usuario cliente no encontrado' });
    res.json({ message: 'Usuario cliente eliminado correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar usuario cliente' });
  }
});

// POST /api/client-users/import — importación masiva por CSV
router.post('/import', authenticate, requireEditor, async (req, res) => {
  const { users } = req.body;
  if (!Array.isArray(users) || users.length === 0) {
    return res.status(400).json({ error: 'No se proporcionaron usuarios para importar' });
  }
  const client = await pool.connect();
  let inserted = 0, updated = 0, errors = [];
  try {
    await client.query('BEGIN');
    for (const u of users) {
      if (!u.first_name || !u.last_name) {
        errors.push(`Fila inválida (falta nombre o apellidos): ${JSON.stringify(u)}`);
        continue;
      }
      try {
        // Si tiene employee_id, hacer upsert por employee_id; si no, insertar siempre
        let result;
        if (u.employee_id?.trim()) {
          result = await client.query(
            `INSERT INTO client_users (first_name, last_name, email, phone, department, position, employee_id, notes, active)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (employee_id) DO UPDATE SET
               first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name,
               email=EXCLUDED.email, phone=EXCLUDED.phone, department=EXCLUDED.department,
               position=EXCLUDED.position, notes=EXCLUDED.notes,
               active=EXCLUDED.active, updated_at=NOW()
             RETURNING (xmax = 0) AS inserted`,
            [
              u.first_name.trim(), u.last_name.trim(),
              u.email?.trim().toLowerCase() || null,
              u.phone?.trim() || null,
              u.department?.trim() || null,
              u.position?.trim() || null,
              u.employee_id.trim(),
              u.notes?.trim() || null,
              u.active !== 'false' && u.active !== false,
            ]
          );
        } else {
          result = await client.query(
            `INSERT INTO client_users (first_name, last_name, email, phone, department, position, notes, active)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             RETURNING (xmax = 0) AS inserted`,
            [
              u.first_name.trim(), u.last_name.trim(),
              u.email?.trim().toLowerCase() || null,
              u.phone?.trim() || null,
              u.department?.trim() || null,
              u.position?.trim() || null,
              u.notes?.trim() || null,
              u.active !== 'false' && u.active !== false,
            ]
          );
        }
        if (result.rows[0].inserted) inserted++;
        else updated++;
      } catch (rowErr) {
        errors.push(`Error en ${u.first_name} ${u.last_name}: ${rowErr.message}`);
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

module.exports = router;
