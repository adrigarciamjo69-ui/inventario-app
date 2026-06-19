// Helper para envio de emails. Soporta dos proveedores:
//   - 'smtp' : nodemailer + servidor SMTP clasico (Gmail, sendgrid, postfix, etc.)
//   - 'm365' : Microsoft Graph API con client_credentials (OAuth2). Recomendado para
//              tenants Microsoft 365 modernos donde SMTP AUTH suele estar deshabilitado.
//
// Configuracion almacenada en app_settings:
//   email_provider           'smtp' | 'm365'
//   smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password, smtp_from
//   m365_tenant_id           ID de directorio (GUID o dominio)
//   m365_client_id           Application (client) ID del App Registration
//   m365_client_secret       Secret value del App Registration
//   m365_sender              Email del buzon usado como remitente (ej. inventario@empresa.com)
//
// Permiso de Azure AD requerido en 'm365':
//   Microsoft Graph - Mail.Send  (tipo Application, NO Delegated)
//   Otorgar consentimiento de administrador.
const nodemailer = require('nodemailer');
const { pool } = require('./db');

async function getEmailConfig() {
  const { rows } = await pool.query(
    "SELECT key, value FROM app_settings WHERE key LIKE 'smtp\\_%' ESCAPE '\\' OR key LIKE 'm365\\_%' ESCAPE '\\' OR key = 'email_provider'"
  );
  const cfg = {};
  rows.forEach((r) => {
    try { cfg[r.key] = JSON.parse(r.value); }
    catch { cfg[r.key] = r.value; }
  });
  if (!cfg.email_provider) cfg.email_provider = 'smtp';
  return cfg;
}

// Alias retro-compatible con la version anterior del modulo.
async function getSmtpConfig() { return getEmailConfig(); }

// ---------------------------------------------------------------------------
// Modo SMTP
// ---------------------------------------------------------------------------
let cachedTransporter = null;
let cachedKey = null;

async function getTransporter() {
  const cfg = await getEmailConfig();
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

function invalidateCache() {
  cachedTransporter = null; cachedKey = null;
  cachedToken = null; cachedTokenExp = 0;
}

// ---------------------------------------------------------------------------
// Modo M365 (Microsoft Graph, client credentials)
// ---------------------------------------------------------------------------
let cachedToken = null;
let cachedTokenExp = 0;

// Decodifica el payload de un JWT sin validar la firma (solo para inspeccionar
// claims locales como `roles` y `aud`). NO usar para autorizacion.
function decodeJwtPayload(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch { return null; }
}

async function getGraphToken(cfg) {
  if (!cfg.m365_tenant_id || !cfg.m365_client_id || !cfg.m365_client_secret) {
    throw new Error('M365 no configurado (faltan tenant_id, client_id o client_secret)');
  }
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedTokenExp > now + 60) return cachedToken;
  const url = 'https://login.microsoftonline.com/' + encodeURIComponent(cfg.m365_tenant_id) + '/oauth2/v2.0/token';
  const body = new URLSearchParams({
    client_id: cfg.m365_client_id,
    client_secret: cfg.m365_client_secret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) {
    const desc = data.error_description || data.error || `HTTP ${r.status}`;
    throw new Error(`Error obteniendo token M365: ${desc}`);
  }
  cachedToken = data.access_token;
  cachedTokenExp = now + (data.expires_in || 3500);
  return cachedToken;
}

// Traduce errores comunes de Microsoft Graph a un mensaje claro en espanol.
// Solo se invoca cuando la respuesta NO es 2xx.
function explainGraphError(status, errText, sender) {
  const lower = (errText || '').toLowerCase();
  if (status === 403 && lower.includes('erroraccessdenied')) {
    return (
      'Microsoft Graph rechazo el envio (403 ErrorAccessDenied). Causas habituales:\n' +
      '  1. El App Registration NO tiene el permiso "Mail.Send" como Application (no Delegated),\n' +
      '     o no se ha otorgado el consentimiento de administrador.\n' +
      '  2. El buzon remitente (' + (sender || '?') + ') no existe en el tenant o no tiene licencia Exchange Online.\n' +
      '  3. Hay una ApplicationAccessPolicy en Exchange que restringe los buzones desde los que esta\n' +
      '     aplicacion puede enviar. Comprueba: Get-ApplicationAccessPolicy en PowerShell de Exchange.\n' +
      'Detalle: ' + (errText || '').slice(0, 200)
    );
  }
  if (status === 404) {
    return 'Buzon remitente no encontrado (' + (sender || '?') + '). Verifica que el email existe en el tenant. Detalle: ' + (errText || '').slice(0, 200);
  }
  if (status === 401) {
    return 'Token rechazado (401). Revisa tenant_id, client_id y client_secret. Detalle: ' + (errText || '').slice(0, 200);
  }
  return 'Microsoft Graph respondio ' + status + ': ' + (errText || '').slice(0, 300);
}

async function sendMailGraph(cfg, { to, subject, text, html }) {
  if (!cfg.m365_sender) throw new Error('Falta m365_sender (email del buzon remitente)');
  const token = await getGraphToken(cfg);
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (recipients.length === 0) throw new Error('Sin destinatarios');
  const payload = {
    message: {
      subject: subject || '(sin asunto)',
      body: html
        ? { contentType: 'HTML', content: html }
        : { contentType: 'Text', content: text || '' },
      toRecipients: recipients.map((addr) => ({ emailAddress: { address: addr } })),
    },
    saveToSentItems: false,
  };
  const url = 'https://graph.microsoft.com/v1.0/users/' + encodeURIComponent(cfg.m365_sender) + '/sendMail';
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (r.status !== 202) {
    const errText = await r.text().catch(() => '');
    throw new Error(explainGraphError(r.status, errText, cfg.m365_sender));
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// API publica
// ---------------------------------------------------------------------------
async function sendMail({ to, subject, text, html }) {
  const cfg = await getEmailConfig();
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (recipients.length === 0) throw new Error('Sin destinatarios');

  if (cfg.email_provider === 'm365') {
    return sendMailGraph(cfg, { to: recipients, subject, text, html });
  }
  // Default: SMTP
  const { transporter } = await getTransporter();
  if (!transporter) throw new Error('SMTP no configurado');
  const from = cfg.smtp_from || cfg.smtp_user || 'inventario@localhost';
  return transporter.sendMail({ from, to: recipients.join(','), subject, text, html });
}

async function testConnection() {
  const cfg = await getEmailConfig();
  if (cfg.email_provider === 'm365') {
    // 1) Obtener un token (valida tenant_id, client_id, client_secret).
    const token = await getGraphToken(cfg);
    // 2) Comprobar que el token incluye el permiso Mail.Send (claim `roles`).
    //    En client_credentials, los permisos de aplicacion aparecen aqui.
    //    Si no esta, los envios futuros fallaran con 403 ErrorAccessDenied.
    const payload = decodeJwtPayload(token) || {};
    const roles = Array.isArray(payload.roles) ? payload.roles : [];
    if (!roles.includes('Mail.Send')) {
      throw new Error(
        'El token NO contiene el permiso "Mail.Send" como Application. ' +
        'Anade el permiso en Azure AD > App registrations > tu app > API permissions ' +
        '> Microsoft Graph > Application permissions > Mail.Send, y otorga ' +
        'consentimiento de administrador. Roles actuales: ' + (roles.join(', ') || '(ninguno)')
      );
    }
    // 3) Comprobar que el buzon remitente existe y es accesible.
    if (cfg.m365_sender) {
      const url = 'https://graph.microsoft.com/v1.0/users/' + encodeURIComponent(cfg.m365_sender) + '?$select=id,mail,userPrincipalName,accountEnabled';
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
      if (r.status === 404) {
        throw new Error('El buzon remitente "' + cfg.m365_sender + '" no existe en el tenant.');
      }
      if (r.status === 403) {
        // El token no tiene User.Read.All; no es bloqueante para enviar mail si
        // Mail.Send esta concedido, pero avisamos al usuario.
        return {
          ok: true,
          provider: 'm365',
          warning: 'No se pudo verificar la existencia del buzon (' + cfg.m365_sender + ') porque el App Registration no tiene User.Read.All. Mail.Send esta OK, el envio deberia funcionar si el buzon existe.',
        };
      }
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        throw new Error('Error verificando el buzon remitente: ' + r.status + ' ' + t.slice(0, 200));
      }
      const userData = await r.json().catch(() => ({}));
      if (userData.accountEnabled === false) {
        throw new Error('El buzon remitente "' + cfg.m365_sender + '" existe pero esta deshabilitado en Azure AD.');
      }
    }
    return { ok: true, provider: 'm365' };
  }
  const { transporter } = await getTransporter();
  if (!transporter) throw new Error('SMTP no configurado');
  await transporter.verify();
  return { ok: true, provider: 'smtp' };
}

// Alias retro-compatible
async function testSmtp() { return testConnection(); }

module.exports = { sendMail, testSmtp, testConnection, getSmtpConfig, getEmailConfig, invalidateCache };
