// Helper para envio de emails (notificaciones de escaneos programados, etc.)
// Lee la configuracion SMTP desde la tabla app_settings (claves smtp_*).
const nodemailer = require('nodemailer');
const { pool } = require('./db');

async function getSmtpConfig() {
  const { rows } = await pool.query("SELECT key, value FROM app_settings WHERE key LIKE 'smtp\\_%' ESCAPE '\\'");
  const cfg = {};
  rows.forEach((r) => {
    try { cfg[r.key] = JSON.parse(r.value); }
    catch { cfg[r.key] = r.value; }
  });
  return cfg;
}

let cachedTransporter = null;
let cachedKey = null;

async function getTransporter() {
  const cfg = await getSmtpConfig();
  const key = JSON.stringify({
    h: cfg.smtp_host, p: cfg.smtp_port, s: cfg.smtp_secure, u: cfg.smtp_user,
    pw: cfg.smtp_password ? '***' + String(cfg.smtp_password).length : '',
  });
  if (cachedTransporter && cachedKey === key) return { transporter: cachedTransporter, cfg };
  if (!cfg.smtp_host) return { transporter: null, cfg };
  const port = parseInt(cfg.smtp_port) || 587;
  const transporter = nodemailer.createTransport({
    host: cfg.smtp_host,
    port,
    secure: cfg.smtp_secure === true || cfg.smtp_secure === 'true' || port === 465,
    auth: cfg.smtp_user ? { user: cfg.smtp_user, pass: cfg.smtp_password || '' } : undefined,
    tls: { rejectUnauthorized: false },
  });
  cachedTransporter = transporter;
  cachedKey = key;
  return { transporter, cfg };
}

function invalidateCache() { cachedTransporter = null; cachedKey = null; }

async function sendMail({ to, subject, text, html }) {
  const { transporter, cfg } = await getTransporter();
  if (!transporter) throw new Error('SMTP no configurado');
  const recipients = Array.isArray(to) ? to.filter(Boolean) : (to ? [to] : []);
  if (recipients.length === 0) throw new Error('Sin destinatarios');
  const from = cfg.smtp_from || cfg.smtp_user || 'inventario@localhost';
  return transporter.sendMail({ from, to: recipients.join(','), subject, text, html });
}

async function testSmtp(overrides) {
  if (overrides && overrides.smtp_host) {
    const port = parseInt(overrides.smtp_port) || 587;
    const t = nodemailer.createTransport({
      host: overrides.smtp_host, port,
      secure: overrides.smtp_secure === true || overrides.smtp_secure === 'true' || port === 465,
      auth: overrides.smtp_user ? { user: overrides.smtp_user, pass: overrides.smtp_password || '' } : undefined,
      tls: { rejectUnauthorized: false },
    });
    await t.verify();
    return true;
  }
  const { transporter } = await getTransporter();
  if (!transporter) throw new Error('SMTP no configurado');
  await transporter.verify();
  return true;
}

module.exports = { sendMail, testSmtp, getSmtpConfig, invalidateCache };
