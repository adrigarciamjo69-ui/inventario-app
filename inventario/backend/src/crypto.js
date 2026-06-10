/**
 * crypto.js - Cifrado simetrico para secretos sensibles (credenciales de escaneo).
 * Usa AES-256-GCM con una clave derivada de SCAN_SECRET_KEY (o, en su defecto,
 * JWT_SECRET). El formato almacenado es: v1:<iv>:<tag>:<ciphertext> (todo base64).
 *
 * IMPORTANTE: define SCAN_SECRET_KEY en el entorno de produccion. Si cambias la
 * clave, los secretos cifrados con la anterior dejaran de poder descifrarse.
 */
const crypto = require('crypto');

const RAW_KEY =
  process.env.SCAN_SECRET_KEY ||
  process.env.JWT_SECRET ||
  'inventarioit_secret_change_in_production';

// Derivamos una clave de 32 bytes (256 bits) a partir del secreto configurado.
const KEY = crypto.createHash('sha256').update(String(RAW_KEY)).digest();

function encrypt(plain) {
  if (plain === undefined || plain === null || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

function decrypt(blob) {
  if (!blob) return null;
  try {
    const [v, ivb, tagb, encb] = String(blob).split(':');
    if (v !== 'v1') return null;
    const iv = Buffer.from(ivb, 'base64');
    const tag = Buffer.from(tagb, 'base64');
    const enc = Buffer.from(encb, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch (err) {
    console.error('decrypt error:', err.message);
    return null;
  }
}

module.exports = { encrypt, decrypt };
