/**
 * audit.js — helpers para el log de auditoría de activos
 */
const { pool } = require('./db');

const FIELD_LABELS = {
  serial_number:  'Nº Serie',
  category:       'Categoría',
  brand:          'Marca',
  model:          'Modelo',
  price:          'Precio',
  purchase_date:  'F. Compra',
  purchase_order: 'Orden compra',
  assigned_to:    'Asignado a',
  department:     'Departamento',
  status:         'Estado',
  notes:          'Notas',
};

/**
 * Compara dos versiones del asset y genera un array de cambios.
 */
function diffAsset(oldObj, newObj) {
  const changes = [];
  const fields = Object.keys(FIELD_LABELS);
  for (const field of fields) {
    const oldVal = oldObj?.[field] ?? null;
    const newVal = newObj?.[field] ?? null;
    const oldStr = oldVal === null || oldVal === '' ? null : String(oldVal);
    const newStr = newVal === null || newVal === '' ? null : String(newVal);
    if (oldStr !== newStr) {
      changes.push({
        field,
        label: FIELD_LABELS[field] || field,
        old:   oldStr,
        new:   newStr,
      });
    }
  }
  return changes;
}

/**
 * Escribe una entrada en el log. Non-blocking (fire & forget).
 */
async function logChange({ assetId, userId, userName, action, changes }) {
  try {
    await pool.query(
      `INSERT INTO asset_audit_log (asset_id, user_id, user_name, action, changes)
       VALUES ($1, $2, $3, $4, $5)`,
      [assetId, userId || null, userName || 'Sistema', action, JSON.stringify(changes || null)]
    );
  } catch (err) {
    console.error('audit log error:', err.message);
  }
}

module.exports = { logChange, diffAsset };
