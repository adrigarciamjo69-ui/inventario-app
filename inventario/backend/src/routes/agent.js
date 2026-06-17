// Rutas del agente endpoint (Windows/Linux/macOS).
//
// Flujo:
//   1. El admin abre Ajustes -> Agentes y obtiene la enroll_key (compartida).
//   2. El agente se instala en el equipo con la URL del backend + enroll_key.
//   3. POST /api/agent/enroll  -> el agente se da de alta y recibe un TOKEN
//      permanente (unico por equipo). Solo se devuelve en texto plano una vez.
//   4. POST /api/agent/checkin -> el agente envia system_info + software
//      cada N minutos. Se autentica con el token via header X-Agent-Token.
//
// Las rutas de gestion (list/rotate/link/revoke) requieren admin de la app.

const router = require('express').Router();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { pool } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

const AGENT_API_VERSION = '1';

// Directorio donde se guardan los binarios del agente subidos por el admin.
const AGENT_BIN_DIR = '/var/www/inventario/uploads/agent-bin';
if (!fs.existsSync(AGENT_BIN_DIR)) fs.mkdirSync(AGENT_BIN_DIR, { recursive: true });

// Mapeo SO -> nombre fisico en disco.
const OS_FILES = {
  windows:       'inventario-agent-windows.exe',
  linux:         'inventario-agent-linux',
  darwin:        'inventario-agent-darwin',         // alias del binario universal o amd64
  'darwin-amd64':'inventario-agent-darwin-amd64',
  'darwin-arm64':'inventario-agent-darwin-arm64',
};

const uploadBin = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, AGENT_BIN_DIR),
    filename:    (req, file, cb) => {
      const os = String(req.params.os || '').toLowerCase();
      const fname = OS_FILES[os];
      if (!fname) return cb(new Error('SO no soportado: ' + os));
      cb(null, fname);
    },
  }),
  limits: { fileSize: 60 * 1024 * 1024 }, // 60 MB margen
});

// ───────────────────────── helpers ─────────────────────────

function sha256Hex(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || null;
}

async function getSetting(key) {
  const { rows } = await pool.query('SELECT value FROM app_settings WHERE key=$1', [key]);
  if (!rows.length) return null;
  try { return JSON.parse(rows[0].value); }
  catch { return rows[0].value; }
}

async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`,
    [key, JSON.stringify(value)]
  );
}

// Busca un asset cuyo serial_number coincida con el bios_serial reportado.
// Devuelve el id del activo o null. Util para auto-vincular agentes.
async function findAssetBySerial(serial) {
  if (!serial || typeof serial !== 'string') return null;
  const clean = serial.trim();
  if (!clean || clean.length < 4) return null;
  // Comparacion case-insensitive y descartando ceros/espacios alrededor.
  const { rows } = await pool.query(
    `SELECT id FROM assets
      WHERE serial_number IS NOT NULL
        AND UPPER(TRIM(serial_number)) = UPPER($1)
      LIMIT 2`,
    [clean]
  );
  if (rows.length === 1) return rows[0].id;
  return null; // 0 o >1 matches: no auto-vinculamos
}

async function ensureEnrollKey() {
  let k = await getSetting('agent_enroll_key');
  if (!k || typeof k !== 'string' || k.length < 20) {
    k = randomToken(24); // 48 chars hex
    await setSetting('agent_enroll_key', k);
  }
  return k;
}

// ─────────────────────── middleware: agente ────────────────

// Valida el header X-Agent-Token contra agent_devices.token_hash.
async function authenticateAgent(req, res, next) {
  const tok = req.headers['x-agent-token'];
  if (!tok || typeof tok !== 'string') {
    return res.status(401).json({ error: 'Token de agente no proporcionado' });
  }
  try {
    const hash = sha256Hex(tok);
    const { rows } = await pool.query(
      `SELECT * FROM agent_devices WHERE token_hash=$1 AND status='active' LIMIT 1`,
      [hash]
    );
    if (!rows.length) {
      return res.status(401).json({ error: 'Token de agente invalido o revocado' });
    }
    req.agent = rows[0];
    next();
  } catch (e) {
    console.error('authenticateAgent:', e);
    res.status(500).json({ error: 'Error de autenticacion del agente' });
  }
}

// ─────────────────────── endpoints AGENTE ──────────────────

// POST /api/agent/enroll
// Body: { enroll_key, machine_id, hostname, os, os_version, agent_version }
// Devuelve: { token, device_id }  (token solo se entrega aqui, no se guarda en claro)
router.post('/enroll', async (req, res) => {
  try {
    const { enroll_key, machine_id, hostname, os, os_version, agent_version } = req.body || {};
    if (!enroll_key || !machine_id) {
      return res.status(400).json({ error: 'enroll_key y machine_id son obligatorios' });
    }
    const expected = await ensureEnrollKey();
    if (String(enroll_key) !== String(expected)) {
      return res.status(403).json({ error: 'enroll_key invalida' });
    }
    const osNorm = ['windows', 'linux', 'darwin'].includes(String(os || '').toLowerCase())
      ? String(os).toLowerCase() : null;

    // Genera token nuevo y guarda solo el hash. Si el machine_id ya existia,
    // rota su token (reinstalacion del agente en el mismo equipo).
    const token = randomToken(32); // 64 chars hex
    const tokenHash = sha256Hex(token);
    const ip = clientIp(req);

    const { rows } = await pool.query(
      `INSERT INTO agent_devices
         (machine_id, hostname, os, os_version, agent_version, token_hash,
          status, last_ip, last_seen, first_seen, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, NOW(), NOW(), NOW(), NOW())
       ON CONFLICT (machine_id) DO UPDATE SET
         hostname      = COALESCE(EXCLUDED.hostname, agent_devices.hostname),
         os            = COALESCE(EXCLUDED.os, agent_devices.os),
         os_version    = COALESCE(EXCLUDED.os_version, agent_devices.os_version),
         agent_version = COALESCE(EXCLUDED.agent_version, agent_devices.agent_version),
         token_hash    = EXCLUDED.token_hash,
         status        = 'active',
         last_ip       = EXCLUDED.last_ip,
         updated_at    = NOW()
       RETURNING id`,
      [String(machine_id).slice(0, 100),
       hostname ? String(hostname).slice(0, 255) : null,
       osNorm,
       os_version ? String(os_version).slice(0, 100) : null,
       agent_version ? String(agent_version).slice(0, 20) : null,
       tokenHash,
       ip ? String(ip).slice(0, 45) : null]
    );
    res.json({ token, device_id: rows[0].id, api_version: AGENT_API_VERSION });
  } catch (err) {
    console.error('agent/enroll:', err);
    res.status(500).json({ error: 'Error en el enrolamiento del agente' });
  }
});

// POST /api/agent/checkin
// Header: X-Agent-Token
// Body: { hostname, os, os_version, agent_version, system_info, software }
router.post('/checkin', authenticateAgent, async (req, res) => {
  const { hostname, os, os_version, agent_version, system_info, software } = req.body || {};
  const ip = clientIp(req);
  try {
    // 1. Actualiza metadatos del agente (last_seen, ip, version, etc.)
    await pool.query(
      `UPDATE agent_devices SET
         hostname      = COALESCE($2, hostname),
         os            = COALESCE($3, os),
         os_version    = COALESCE($4, os_version),
         agent_version = COALESCE($5, agent_version),
         last_ip       = COALESCE($6, last_ip),
         last_seen     = NOW(),
         updated_at    = NOW()
       WHERE id=$1`,
      [req.agent.id,
       hostname ? String(hostname).slice(0, 255) : null,
       os ? String(os).toLowerCase().slice(0, 20) : null,
       os_version ? String(os_version).slice(0, 100) : null,
       agent_version ? String(agent_version).slice(0, 20) : null,
       ip ? String(ip).slice(0, 45) : null]
    );

    // 2. AUTO-VINCULACION: si todavia no esta vinculado a un activo y el agente
    //    nos envia el bios_serial en system_info, intentamos hacer match exacto
    //    contra assets.serial_number. Solo vinculamos si encontramos 1 unico match.
    let assetId = req.agent.asset_id;
    let autoLinked = false;
    if (!assetId && system_info && typeof system_info === 'object') {
      const serial = (system_info.bios && system_info.bios.serial)
                  || (system_info.bios && system_info.bios.Serial)
                  || null;
      const matched = await findAssetBySerial(serial);
      if (matched) {
        await pool.query('UPDATE agent_devices SET asset_id=$1, updated_at=NOW() WHERE id=$2', [matched, req.agent.id]);
        assetId = matched;
        autoLinked = true;
        console.log(`[agent] auto-vinculado device_id=${req.agent.id} -> asset_id=${matched} via serial=${serial}`);
      }
    }
    if (assetId) {
      if (system_info && typeof system_info === 'object') {
        try {
          await pool.query(
            `INSERT INTO asset_system_info (asset_id, scanned_data, scanned_at, source, updated_at)
             VALUES ($1, $2, NOW(), 'agent', NOW())
             ON CONFLICT (asset_id) DO UPDATE SET
               scanned_data = EXCLUDED.scanned_data,
               scanned_at   = EXCLUDED.scanned_at,
               source       = EXCLUDED.source,
               updated_at   = NOW()`,
            [assetId, JSON.stringify(system_info)]
          );
        } catch (e) { console.warn('checkin asset_system_info:', e.message); }
      }
      if (Array.isArray(software) && software.length) {
        try {
          await pool.query(
            `INSERT INTO asset_software (asset_id, software, scanned_at, source, updated_at)
             VALUES ($1, $2, NOW(), 'agent', NOW())
             ON CONFLICT (asset_id) DO UPDATE SET
               software   = EXCLUDED.software,
               scanned_at = EXCLUDED.scanned_at,
               source     = EXCLUDED.source,
               updated_at = NOW()`,
            [assetId, JSON.stringify(software)]
          );
        } catch (e) { console.warn('checkin asset_software:', e.message); }
      }
    }
    res.json({
      ok: true,
      linked: !!assetId,
      auto_linked: autoLinked,
      asset_id: assetId,
      next_checkin_seconds: 3600,   // sugerencia: 1h
    });
  } catch (err) {
    console.error('agent/checkin:', err);
    res.status(500).json({ error: 'Error procesando el checkin' });
  }
});

// ─────────────────── endpoints ADMIN (UI) ──────────────────

// GET /api/agent/config — devuelve enroll_key + URL sugerida para el instalador
router.get('/config', authenticate, requireAdmin, async (req, res) => {
  try {
    const key = await ensureEnrollKey();
    res.json({ enroll_key: key, api_version: AGENT_API_VERSION });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener configuracion del agente' });
  }
});

// POST /api/agent/config/rotate-key — genera una enroll_key nueva
router.post('/config/rotate-key', authenticate, requireAdmin, async (req, res) => {
  try {
    const k = randomToken(24);
    await setSetting('agent_enroll_key', k);
    res.json({ enroll_key: k });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al rotar la enroll_key' });
  }
});

// GET /api/agent/list — lista de agentes registrados
router.get('/list', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.id, d.machine_id, d.hostname, d.os, d.os_version, d.agent_version,
              d.status, d.last_ip, d.last_seen, d.first_seen, d.asset_id,
              a.id AS asset_code
         FROM agent_devices d
         LEFT JOIN assets a ON a.id = d.asset_id
         ORDER BY d.last_seen DESC NULLS LAST, d.first_seen DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al listar agentes' });
  }
});

// POST /api/agent/:id/link — vincula el agente con un activo existente
router.post('/:id/link', authenticate, requireAdmin, async (req, res) => {
  const { asset_id } = req.body || {};
  if (!asset_id) return res.status(400).json({ error: 'asset_id obligatorio' });
  try {
    const a = await pool.query('SELECT 1 FROM assets WHERE id=$1', [asset_id]);
    if (!a.rowCount) return res.status(404).json({ error: 'Activo no encontrado' });
    const { rows } = await pool.query(
      `UPDATE agent_devices SET asset_id=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
      [asset_id, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Agente no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al vincular el agente' });
  }
});

// POST /api/agent/:id/unlink — quita el vinculo con el activo
router.post('/:id/unlink', authenticate, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE agent_devices SET asset_id=NULL, updated_at=NOW() WHERE id=$1 RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Agente no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al desvincular el agente' });
  }
});

// POST /api/agent/:id/disable | enable
router.post('/:id/disable', authenticate, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE agent_devices SET status='disabled', updated_at=NOW() WHERE id=$1 RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Agente no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al deshabilitar el agente' });
  }
});
router.post('/:id/enable', authenticate, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE agent_devices SET status='active', updated_at=NOW() WHERE id=$1 RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Agente no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al habilitar el agente' });
  }
});

// DELETE /api/agent/:id — borra definitivamente el agente (el equipo tendra
// que volver a enrolarse si quieres recuperarlo).
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM agent_devices WHERE id=$1', [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Agente no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al borrar el agente' });
  }
});

// ────────────────────── binarios del agente ───────────────────

// GET /api/agent/download/:os — PUBLICO. Sirve el binario subido para ese SO.
// El instalador (PowerShell/curl) lo descarga sin autenticarse: solo se necesita
// haber subido antes el binario desde Ajustes → Agentes.
router.get('/download/:os', async (req, res) => {
  const os = String(req.params.os || '').toLowerCase();
  const fname = OS_FILES[os];
  if (!fname) return res.status(404).json({ error: 'SO no soportado' });
  const full = path.join(AGENT_BIN_DIR, fname);
  if (!fs.existsSync(full)) {
    return res.status(404).json({ error: 'Binario no subido todavia. Subelo desde Ajustes → Agentes.' });
  }
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
  fs.createReadStream(full).pipe(res);
});

// GET /api/agent/binaries — lista de binarios disponibles + metadata.
router.get('/binaries', authenticate, async (req, res) => {
  const result = {};
  for (const [os, fname] of Object.entries(OS_FILES)) {
    const full = path.join(AGENT_BIN_DIR, fname);
    if (fs.existsSync(full)) {
      const st = fs.statSync(full);
      result[os] = {
        filename: fname,
        size: st.size,
        uploaded_at: st.mtime.toISOString(),
        url: `/api/agent/download/${os}`,
      };
    } else {
      result[os] = null;
    }
  }
  res.json(result);
});

// POST /api/agent/binaries/:os — multipart "file". Solo admin.
// Envolvemos multer manualmente para devolver JSON con el detalle del error
// en lugar del HTML por defecto de Express (tamano excedido, EACCES, etc).
router.post('/binaries/:os', authenticate, requireAdmin, (req, res) => {
  const os = String(req.params.os || '').toLowerCase();
  if (!OS_FILES[os]) {
    return res.status(400).json({ error: 'SO no soportado: ' + os });
  }
  // Verifica que el directorio existe y es escribible. Si falla aqui, da un
  // mensaje claro en vez de un EACCES enterrado en logs de multer.
  try {
    if (!fs.existsSync(AGENT_BIN_DIR)) fs.mkdirSync(AGENT_BIN_DIR, { recursive: true });
    fs.accessSync(AGENT_BIN_DIR, fs.constants.W_OK);
  } catch (e) {
    console.error('[agent] directorio de binarios no escribible:', AGENT_BIN_DIR, e.message);
    return res.status(500).json({
      error: 'El servidor no puede escribir en ' + AGENT_BIN_DIR + ' (' + e.code + '). ' +
             'Crea el directorio y dale permisos al usuario que corre el backend: ' +
             'sudo mkdir -p ' + AGENT_BIN_DIR + ' && sudo chown -R $(stat -c %U $(dirname ' + AGENT_BIN_DIR + ')) ' + AGENT_BIN_DIR,
    });
  }

  uploadBin.single('file')(req, res, (err) => {
    if (err) {
      console.error('[agent] error subiendo binario', os, ':', err.code || err.name, '-', err.message);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: 'Fichero demasiado grande (limite 60 MB). Tamano subido: ' +
                 (req.headers['content-length'] || '?') + ' bytes',
        });
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: 'Campo inesperado. El input debe llamarse "file".' });
      }
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        return res.status(500).json({
          error: 'Sin permisos para escribir en ' + AGENT_BIN_DIR +
                 ' (' + err.code + '). Revisa el chown/chmod del directorio.',
        });
      }
      if (err.code === 'ENOSPC') {
        return res.status(507).json({ error: 'Sin espacio en disco en el servidor.' });
      }
      return res.status(500).json({
        error: 'Error subiendo binario: ' + (err.message || err.code || 'desconocido'),
      });
    }
    if (!req.file) return res.status(400).json({ error: 'No se recibio ningun fichero en el campo "file".' });
    res.json({
      ok: true,
      os,
      filename: req.file.filename,
      size: req.file.size,
    });
  });
});

// DELETE /api/agent/binaries/:os — borra el binario subido.
router.delete('/binaries/:os', authenticate, requireAdmin, async (req, res) => {
  const os = String(req.params.os || '').toLowerCase();
  const fname = OS_FILES[os];
  if (!fname) return res.status(404).json({ error: 'SO no soportado' });
  const full = path.join(AGENT_BIN_DIR, fname);
  try { if (fs.existsSync(full)) fs.unlinkSync(full); } catch (_) {}
  res.json({ ok: true });
});

// ───────── GET /api/agent/install/:os ─────────
// Devuelve un script de instalacion auto-contenido (PowerShell para Windows,
// bash para Linux/macOS) con la URL del backend y la enroll_key embebidas.
// El admin solo tiene que pegar UN comando en la maquina destino:
//
//   Windows:  powershell -ExecutionPolicy Bypass -Command "iwr 'https://servidor/api/agent/install/windows?key=ABCD' -UseBasicParsing | iex"
//   Linux:    curl -fsSL 'https://servidor/api/agent/install/linux?key=ABCD' | sudo bash
//   macOS:    curl -fsSL 'https://servidor/api/agent/install/darwin?key=ABCD' | sudo bash
//
// La key viaja en la query string -> queda embebida en el script -> el comando
// 'enroll' la usa para registrarse. Si la key es invalida, el enroll falla.
// No validamos la key aqui (igual que en /download) porque tener el script
// sin key valida no permite enrolarse: la verificacion real ocurre en /enroll.
router.get('/install/:os', (req, res) => {
  const os = String(req.params.os || '').toLowerCase();
  const key = String(req.query.key || '').trim();
  if (!['windows', 'linux', 'darwin'].includes(os)) {
    return res.status(404).type('text/plain').send('SO no soportado: ' + os);
  }
  // Construye la URL base del servidor desde la peticion (respeta proxy https).
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').toString().split(',')[0].trim();
  const host  = (req.headers['x-forwarded-host']  || req.headers.host || '').toString().split(',')[0].trim();
  const baseUrl = proto + '://' + host;

  if (os === 'windows') {
    res.type('text/plain; charset=utf-8');
    res.set('Content-Disposition', 'inline; filename="install-inventario-agent.ps1"');
    return res.send(buildWindowsInstaller(baseUrl, key));
  }
  res.type('text/plain; charset=utf-8');
  res.set('Content-Disposition', 'inline; filename="install-inventario-agent.sh"');
  return res.send(os === 'linux' ? buildLinuxInstaller(baseUrl, key) : buildMacInstaller(baseUrl, key));
});

function buildWindowsInstaller(url, key) {
  // PowerShell. Se ejecuta con: iwr ... | iex
  return [
    '# Inventario Agent - instalacion automatica',
    '$ErrorActionPreference = "Stop"',
    '$Url = "' + url + '"',
    '$Key = "' + key + '"',
    '',
    'if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {',
    '    Write-Host "[!] Ejecuta este comando en PowerShell como Administrador." -ForegroundColor Red',
    '    return',
    '}',
    '',
    '$Dir = "C:\\ProgramData\\inventario-agent"',
    '$Exe = "$Dir\\inventario-agent.exe"',
    'New-Item -ItemType Directory -Force -Path $Dir | Out-Null',
    '',
    'Write-Host "[1/4] Descargando agente desde $Url ..." -ForegroundColor Cyan',
    '$prev = $ProgressPreference; $ProgressPreference = "SilentlyContinue"',
    'try { Invoke-WebRequest -Uri "$Url/api/agent/download/windows" -OutFile $Exe -UseBasicParsing }',
    'finally { $ProgressPreference = $prev }',
    '',
    'Write-Host "[2/4] Enrolando equipo..." -ForegroundColor Cyan',
    '& $Exe enroll --server $Url --key $Key',
    'if ($LASTEXITCODE -ne 0) { Write-Host "[!] enroll fallo (codigo $LASTEXITCODE). Revisa la enroll_key." -ForegroundColor Red; return }',
    '',
    'Write-Host "[3/4] Registrando servicio de Windows..." -ForegroundColor Cyan',
    '$svc = Get-Service -Name InventarioAgent -ErrorAction SilentlyContinue',
    'if ($svc) {',
    '    if ($svc.Status -eq "Running") { Stop-Service InventarioAgent -Force }',
    '    sc.exe delete InventarioAgent | Out-Null',
    '    Start-Sleep -Seconds 2',
    '}',
    'New-Service -Name "InventarioAgent" -DisplayName "Inventario Agent" -BinaryPathName "$Exe run" -StartupType Automatic | Out-Null',
    '',
    'Write-Host "[4/4] Arrancando servicio..." -ForegroundColor Cyan',
    'Start-Service InventarioAgent',
    '',
    'Write-Host ""',
    'Write-Host "[OK] Inventario Agent instalado y corriendo." -ForegroundColor Green',
    'Get-Service InventarioAgent | Format-Table -AutoSize',
    '',
  ].join('\r\n');
}

function buildLinuxInstaller(url, key) {
  return [
    '#!/bin/bash',
    '# Inventario Agent - instalacion automatica (Linux con systemd)',
    'set -euo pipefail',
    'URL="' + url + '"',
    'KEY="' + key + '"',
    '',
    'if [ "$EUID" -ne 0 ]; then echo "[!] Ejecuta con sudo: curl -fsSL \\"$URL/api/agent/install/linux?key=$KEY\\" | sudo bash"; exit 1; fi',
    '',
    'echo "[1/4] Descargando agente desde $URL ..."',
    'curl -fsSL "$URL/api/agent/download/linux" -o /usr/local/bin/inventario-agent',
    'chmod +x /usr/local/bin/inventario-agent',
    '',
    'echo "[2/4] Enrolando equipo..."',
    '/usr/local/bin/inventario-agent enroll --server "$URL" --key "$KEY"',
    '',
    'echo "[3/4] Instalando servicio systemd..."',
    'cat >/etc/systemd/system/inventario-agent.service <<EOF',
    '[Unit]',
    'Description=Inventario Agent',
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'ExecStart=/usr/local/bin/inventario-agent run',
    'Restart=always',
    'RestartSec=10',
    'User=root',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    'EOF',
    'systemctl daemon-reload',
    '',
    'echo "[4/4] Arrancando servicio..."',
    'systemctl enable --now inventario-agent',
    'sleep 1',
    'systemctl status inventario-agent --no-pager -l | head -15 || true',
    '',
    'echo ""',
    'echo "[OK] Inventario Agent instalado y corriendo."',
    '',
  ].join('\n');
}

function buildMacInstaller(url, key) {
  return [
    '#!/bin/bash',
    '# Inventario Agent - instalacion automatica (macOS con LaunchDaemon)',
    'set -euo pipefail',
    'URL="' + url + '"',
    'KEY="' + key + '"',
    '',
    'if [ "$EUID" -ne 0 ]; then echo "[!] Ejecuta con sudo: curl -fsSL \\"$URL/api/agent/install/darwin?key=$KEY\\" | sudo bash"; exit 1; fi',
    '',
    'echo "[1/4] Descargando agente desde $URL ..."',
    'mkdir -p /usr/local/bin',
    'curl -fsSL "$URL/api/agent/download/darwin" -o /usr/local/bin/inventario-agent',
    'chmod +x /usr/local/bin/inventario-agent',
    '',
    'echo "[2/4] Enrolando equipo..."',
    '/usr/local/bin/inventario-agent enroll --server "$URL" --key "$KEY"',
    '',
    'echo "[3/4] Instalando LaunchDaemon..."',
    'cat >/Library/LaunchDaemons/com.electrans.inventario-agent.plist <<\'PLIST\'',
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    '  <key>Label</key><string>com.electrans.inventario-agent</string>',
    '  <key>ProgramArguments</key>',
    '  <array>',
    '    <string>/usr/local/bin/inventario-agent</string>',
    '    <string>run</string>',
    '  </array>',
    '  <key>KeepAlive</key><true/>',
    '  <key>RunAtLoad</key><true/>',
    '  <key>StandardOutPath</key><string>/var/log/inventario-agent.log</string>',
    '  <key>StandardErrorPath</key><string>/var/log/inventario-agent.log</string>',
    '</dict></plist>',
    'PLIST',
    'chown root:wheel /Library/LaunchDaemons/com.electrans.inventario-agent.plist',
    'chmod 644       /Library/LaunchDaemons/com.electrans.inventario-agent.plist',
    '',
    'echo "[4/4] Cargando LaunchDaemon..."',
    'launchctl unload /Library/LaunchDaemons/com.electrans.inventario-agent.plist 2>/dev/null || true',
    'launchctl load -w /Library/LaunchDaemons/com.electrans.inventario-agent.plist',
    '',
    'echo ""',
    'echo "[OK] Inventario Agent instalado y corriendo."',
    '',
  ].join('\n');
}

module.exports = router;
