const router = require('express').Router();
const { pool } = require('../db');
const { authenticate, requireEditor, requireAdmin } = require('../middleware/auth');
let emailHelper = null;
try { emailHelper = require('../email'); } catch (_) {}

// Claves SMTP cuyo valor (password) nunca debe devolverse al cliente.
const SMTP_SECRET_KEYS = new Set(['smtp_password']);

// GET /api/settings
router.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT key, value FROM app_settings');
    const result = {};
    rows.forEach(r => {
      if (SMTP_SECRET_KEYS.has(r.key)) {
        // Nunca devolver el password, solo si esta configurado
        result[r.key + '_set'] = !!r.value && r.value !== '""';
        return;
      }
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
    // Si se ha tocado algo de SMTP, invalidar la cache del transporter
    if (emailHelper && Object.keys(settings).some((k) => k.startsWith('smtp_'))) {
      try { emailHelper.invalidateCache(); } catch (_) {}
    }
    res.json({ message: 'Configuración guardada' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al guardar configuración' });
  } finally {
    client.release();
  }
});

// POST /api/settings/smtp/test  -> verifica la configuracion SMTP
router.post('/smtp/test', authenticate, requireAdmin, async (req, res) => {
  if (!emailHelper) return res.status(500).json({ error: 'Modulo de email no disponible' });
  try {
    await emailHelper.testSmtp();
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

// POST /api/settings/smtp/send-test  -> envia un email de prueba
router.post('/smtp/send-test', authenticate, requireAdmin, async (req, res) => {
  if (!emailHelper) return res.status(500).json({ error: 'Modulo de email no disponible' });
  const { to } = req.body || {};
  if (!to) return res.status(400).json({ error: 'Falta destinatario (to)' });
  try {
    await emailHelper.sendMail({
      to,
      subject: '[Inventario] Email de prueba',
      text: 'Este es un email de prueba enviado desde la configuracion SMTP del inventario. Si lo recibes, el envio funciona correctamente.',
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

module.exports = router;
