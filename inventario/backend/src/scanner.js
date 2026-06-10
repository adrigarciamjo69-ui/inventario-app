/**
 * scanner.js - Motor de descubrimiento de red (Fase 2).
 *
 * Flujo:
 *   1. nmap descubre hosts vivos, puertos abiertos y versiones de servicio.
 *   2. Por cada host, se intenta enriquecer con las credenciales del rango
 *      (SSH / SNMP / WinRM) para extraer hostname, SO, fabricante, modelo y
 *      numero de serie.
 *   3. Se devuelve una lista de resultados normalizados listos para revisar
 *      e importar como activos.
 *
 * Dependencias de runtime (OPCIONALES, se cargan con try/require):
 *   - nmap            -> binario del sistema (via backend/nixpacks.toml -> aptPkgs)
 *   - ssh2            -> enriquecimiento SSH (Linux/Unix)
 *   - net-snmp        -> enriquecimiento SNMP (red / impresoras)
 *   - nodejs-winrm    -> enriquecimiento WinRM (Windows, fallback)
 *   - python3-impacket-> enriquecimiento WMI (Windows, principal) via wmi_query.py
 *   - nmap NSE        -> enriquecimiento SMB (Windows, sin librerias extra)
 *
 * Para hosts Windows el orden es WMI -> SMB-NSE -> WinRM. WMI es el metodo
 * que usa Lansweeper y suele estar disponible (puertos 135/445) incluso si
 * WinRM esta cerrado (caso por defecto en Win10/11).
 *
 * Si alguna pieza no esta disponible, el escaneo degrada con elegancia: se
 * devuelven los datos que se hayan podido obtener y nunca se lanza una
 * excepcion por falta de un modulo opcional.
 */
const { spawn } = require('child_process');
const path = require('path');
const { decrypt } = require('./crypto');

// Divide "DOMINIO\\usuario" o "DOMINIO/usuario" en { domain, user }.
function splitWinUser(raw) {
  const s = String(raw || '');
  const m = s.match(/^([^\\\/]+)[\\\/](.+)$/);
  return m ? { domain: m[1], user: m[2] } : { domain: '', user: s };
}

function tryRequire(name) {
  try { return require(name); } catch { return null; }
}

// ───────────────────────────────────────────────────────────────── nmap ────

// Ejecuta nmap con un connect scan (-sT, sin root) + deteccion de versiones.
function runNmap(cidr, { timeoutMs = 1000 * 60 * 15 } = {}) {
  return new Promise((resolve, reject) => {
    // -sT  connect scan (no requiere privilegios root)
    // -sV  deteccion de versiones de servicio
    // -T4  plantilla de tiempos agresiva (mas rapido en LAN)
    // --host-timeout evita que un host lento bloquee todo el escaneo
    // -oX -  emite XML por stdout
    const args = ['-sT', '-sV', '-T4', '--host-timeout', '90s', '-oX', '-', cidr];
    let proc;
    try {
      proc = spawn('nmap', args);
    } catch (e) {
      return reject(new Error('No se pudo ejecutar nmap: ' + e.message));
    }
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (_) {}
      reject(new Error('Tiempo de escaneo agotado'));
    }, timeoutMs);
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error('nmap no esta instalado en el servidor (' + e.message + ')'));
    });
    proc.on('close', () => {
      clearTimeout(timer);
      if (out.trim()) resolve(out);
      else reject(new Error('nmap no devolvio resultados' + (err ? ': ' + err.slice(0, 200) : '')));
    });
  });
}

function attr(tag, name) {
  const m = tag.match(new RegExp(name + '="([^"]*)"'));
  return m ? m[1] : null;
}

// Parser minimalista del XML de nmap (evita dependencias externas).
function parseNmapXml(xml) {
  const hosts = [];
  const hostBlocks = xml.match(/<host\b[\s\S]*?<\/host>/g) || [];
  for (const hb of hostBlocks) {
    const statusTag = (hb.match(/<status\b[^>]*>/) || [])[0];
    const state = statusTag ? attr(statusTag, 'state') : null;
    if (state && state !== 'up') continue;

    let ip = null;
    let mac = null;
    let vendor = null;
    const addrTags = hb.match(/<address\b[^>]*>/g) || [];
    for (const at of addrTags) {
      const type = attr(at, 'addrtype');
      if (type === 'ipv4' || type === 'ipv6') ip = attr(at, 'addr');
      else if (type === 'mac') { mac = attr(at, 'addr'); vendor = attr(at, 'vendor'); }
    }
    if (!ip) continue;

    const hnTag = (hb.match(/<hostname\b[^>]*>/) || [])[0];
    const hostname = hnTag ? attr(hnTag, 'name') : null;

    const ports = [];
    const portBlocks = hb.match(/<port\b[\s\S]*?<\/port>/g) || [];
    for (const pb of portBlocks) {
      const portTag = (pb.match(/<port\b[^>]*>/) || [])[0];
      const stTag = (pb.match(/<state\b[^>]*>/) || [])[0];
      if (!stTag || attr(stTag, 'state') !== 'open') continue;
      const svcTag = (pb.match(/<service\b[^>]*>/) || [])[0];
      ports.push({
        port: parseInt(attr(portTag, 'portid')),
        protocol: attr(portTag, 'protocol'),
        service: svcTag ? attr(svcTag, 'name') : null,
        product: svcTag ? attr(svcTag, 'product') : null,
        version: svcTag ? attr(svcTag, 'version') : null,
      });
    }

    const osTag = (hb.match(/<osmatch\b[^>]*>/) || [])[0];
    const os = osTag ? attr(osTag, 'name') : null;

    hosts.push({ ip, mac, vendor, hostname, os, ports });
  }
  return hosts;
}

// ─────────────────────────────────────────────────── enriquecimiento SSH ────

function execSsh(conn, cmd) {
  return new Promise((resolve) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return resolve('');
      let out = '';
      stream.on('data', (d) => { out += d.toString(); });
      stream.stderr.on('data', () => {});
      stream.on('close', () => resolve(out.trim()));
    });
  });
}

function sshEnrich(host, cred, secret) {
  const ssh2 = tryRequire('ssh2');
  if (!ssh2 || !ssh2.Client) return Promise.resolve({ data: null, error: 'ssh2 no instalado' });
  return new Promise((resolve) => {
    const conn = new ssh2.Client();
    let done = false;
    let lastErr = null;
    const finish = (data, err) => {
      if (done) return;
      done = true;
      try { conn.end(); } catch (_) {}
      resolve({ data, error: err || lastErr });
    };
    const timer = setTimeout(() => finish(null, 'timeout'), 18000);
    conn.on('ready', async () => {
      try {
        // /sys/class/dmi/id/* suele ser legible sin root para vendor/model.
        // El numero de serie a menudo requiere root; si no, queda vacio.
        const data = {};
        data.hostname = await execSsh(conn, 'hostname');
        data.os = await execSsh(conn,
          "(. /etc/os-release 2>/dev/null && echo \"$PRETTY_NAME\") || uname -sr");
        data.vendor = await execSsh(conn, 'cat /sys/class/dmi/id/sys_vendor 2>/dev/null');
        data.model = await execSsh(conn, 'cat /sys/class/dmi/id/product_name 2>/dev/null');
        data.serial = await execSsh(conn, 'cat /sys/class/dmi/id/product_serial 2>/dev/null');
        clearTimeout(timer);
        // Limpia valores vacios o no informativos.
        for (const k of Object.keys(data)) {
          const v = (data[k] || '').trim();
          if (!v || /to be filled|not specified|none|^o\.?e\.?m\.?$/i.test(v)) delete data[k];
          else data[k] = v;
        }
        finish(Object.keys(data).length ? data : null, Object.keys(data).length ? null : 'sin datos');
      } catch (e) {
        clearTimeout(timer);
        finish(null, 'exec: ' + (e && e.message || e));
      }
    });
    conn.on('error', (e) => {
      lastErr = e && e.message ? e.message : String(e);
      clearTimeout(timer);
      finish(null, lastErr);
    });
    try {
      conn.connect({
        host: host.ip,
        port: cred.port || 22,
        username: cred.username || 'root',
        password: secret || undefined,
        readyTimeout: 12000,
      });
    } catch (e) {
      clearTimeout(timer);
      finish(null, 'connect: ' + (e && e.message || e));
    }
  });
}

// ────────────────────────────────────────────────── enriquecimiento SNMP ────

function snmpEnrich(host, cred, secret) {
  const snmp = tryRequire('net-snmp');
  if (!snmp) return Promise.resolve({ data: null, error: 'net-snmp no instalado' });
  return new Promise((resolve) => {
    let done = false;
    let session;
    const finish = (data, err) => {
      if (done) return;
      done = true;
      try { session && session.close(); } catch (_) {}
      resolve({ data, error: err });
    };
    const timer = setTimeout(() => finish(null, 'timeout'), 9000);
    try {
      const community = secret || cred.username || 'public';
      session = snmp.createSession(host.ip, community, { timeout: 4000, retries: 1 });
      const oids = ['1.3.6.1.2.1.1.5.0', '1.3.6.1.2.1.1.1.0'];
      session.get(oids, (error, varbinds) => {
        clearTimeout(timer);
        if (error) return finish(null, error.message || String(error));
        const data = {};
        try {
          if (varbinds[0] && !snmp.isVarbindError(varbinds[0])) data.hostname = varbinds[0].value.toString();
          if (varbinds[1] && !snmp.isVarbindError(varbinds[1])) data.os = varbinds[1].value.toString();
        } catch (_) {}
        finish(Object.keys(data).length ? data : null, Object.keys(data).length ? null : 'sin datos');
      });
    } catch (e) {
      clearTimeout(timer);
      finish(null, e.message || String(e));
    }
  });
}

// ──────────────────────────────────── enriquecimiento SMB (nmap NSE) ────
// Usa scripts NSE para extraer SO, hostname y dominio de hosts Windows.
// Funciona aunque WinRM este cerrado, porque SMB (445) suele estar abierto
// por defecto. Si se pasan credenciales se intentan; si no, se prueba
// acceso anonimo (smb-os-discovery suele funcionar incluso sin creds).

function smbNmapEnrich(host, cred, secret, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve) => {
    const args = ['-Pn', '--script', 'smb-os-discovery,smb-system-info',
                  '-p', '445,139', '--host-timeout', '25s', '-oX', '-', host.ip];
    if (cred && cred.username) {
      const { domain, user } = splitWinUser(cred.username);
      const parts = [`smbusername=${user}`];
      if (secret) parts.push(`smbpassword=${secret}`);
      if (domain) parts.push(`smbdomain=${domain}`);
      args.splice(1, 0, '--script-args', parts.join(','));
    }
    let proc;
    try { proc = spawn('nmap', args); }
    catch (e) { return resolve({ data: null, error: 'nmap: ' + e.message }); }
    let out = '', err = '';
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) {} resolve({ data: null, error: 'timeout' }); }, timeoutMs);
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', (e) => { clearTimeout(timer); resolve({ data: null, error: 'nmap: ' + e.message }); });
    proc.on('close', () => {
      clearTimeout(timer);
      const elems = {};
      const re = /<elem\s+key="([^"]+)">([^<]*)<\/elem>/g;
      let m;
      while ((m = re.exec(out)) !== null) elems[m[1]] = m[2];
      const data = {};
      if (elems.os) data.os = elems.os;
      else if (elems.lanmanager) data.os = elems.lanmanager;
      if (elems.fqdn) data.hostname = elems.fqdn;
      else if (elems.netbios_computer_name) data.hostname = elems.netbios_computer_name;
      else if (elems.server) data.hostname = elems.server;
      if (Object.keys(data).length) return resolve({ data, error: null });
      // Pista del fallo si smb-os-discovery no devolvio info
      let why = 'smb sin datos';
      if (/STATUS_LOGON_FAILURE|NT_STATUS_LOGON_FAILURE/i.test(err) || /STATUS_LOGON_FAILURE/i.test(out)) why = 'credenciales rechazadas';
      else if (/STATUS_ACCESS_DENIED/i.test(out + err)) why = 'acceso denegado';
      else if (/Filtered|filtered/.test(out)) why = 'puerto filtrado';
      resolve({ data: null, error: why });
    });
  });
}

// ─────────────────────────────────── enriquecimiento WMI (impacket) ────
// Llama al helper Python wmi_query.py que usa impacket para hablar DCOM/RPC
// con el host Windows. Es el mismo metodo que usa Lansweeper, funciona aunque
// WinRM este cerrado siempre que el puerto 135 (+ RPC dinamico) este abierto.

// Devuelve { data, error }. data!=null si el enriquecimiento funciono.
function wmiEnrich(host, cred, secret, { timeoutMs = 25000 } = {}) {
  return new Promise((resolve) => {
    const script = path.join(__dirname, 'wmi_query.py');
    const { domain, user } = splitWinUser(cred.username || '');
    const args = [script,
                  '--host', host.ip,
                  '--user', user,
                  '--password', secret || '',
                  '--domain', domain,
                  '--timeout', '15'];
    let proc;
    try {
      proc = spawn('python3', args, {
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      });
    } catch (e) { return resolve({ data: null, error: 'no se pudo lanzar python: ' + e.message }); }
    let out = '', err = '';
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) {} resolve({ data: null, error: 'timeout' }); }, timeoutMs);
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', (e) => { clearTimeout(timer); resolve({ data: null, error: 'python: ' + e.message }); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      // Recoge la razon del fallo del stderr (el helper imprime JSON {error,stage,trace})
      let errMsg = null;
      let stage = null;
      let trace = null;
      let impv = null;
      if (err && err.trim()) {
        try {
          const j = JSON.parse(err.trim().split(/\r?\n/).pop());
          if (j && j.error) {
            errMsg = j.error;
            stage = j.stage || null;
            trace = j.trace || null;
            impv = j.impacket || null;
          }
        } catch (_) { errMsg = err.trim().slice(0, 200); }
      }
      // Etiqueta el error con la fase + version de impacket para diagnostico
      let composed = stage ? `[${stage}] ${errMsg}` : errMsg;
      if (impv) composed = `${composed} (impacket ${impv})`;
      if (errMsg) {
        try {
          console.warn(`[scan][wmi] ${host.ip}: ${composed}`);
          if (trace) console.warn(`[scan][wmi][trace] ${host.ip}: ${trace}`);
        } catch (_) {}
      }
      if (code !== 0 || !out.trim()) {
        return resolve({ data: null, error: composed || ('exit code ' + code) });
      }
      try {
        const lastLine = out.trim().split(/\r?\n/).pop();
        const j = JSON.parse(lastLine);
        if (!j || j.error) return resolve({ data: null, error: (j && j.error) || 'wmi sin datos' });
        const data = {};
        for (const k of ['hostname', 'vendor', 'model', 'serial', 'os']) {
          const v = (j[k] || '').toString().trim();
          if (v && !/to be filled|not specified|default string|system serial number|^o\.?e\.?m\.?$/i.test(v)) {
            data[k] = v;
          }
        }
        if (Object.keys(data).length) return resolve({ data, error: null });
        return resolve({ data: null, error: 'wmi sin campos utiles' });
      } catch (e) {
        return resolve({ data: null, error: 'parse: ' + e.message });
      }
    });
  });
}

// ───────────────────────────────────────────────── enriquecimiento WinRM ────
// Best-effort: la API de nodejs-winrm varia entre versiones, por lo que se
// comprueba que existan los metodos esperados antes de usarlos. Cualquier
// fallo devuelve null sin romper el escaneo.

async function winrmEnrich(host, cred, secret) {
  const winrm = tryRequire('nodejs-winrm');
  if (!winrm || !winrm.shell || !winrm.command) return { data: null, error: 'nodejs-winrm no disponible' };
  const auth = 'Basic ' + Buffer.from(`${cred.username || 'Administrator'}:${secret || ''}`).toString('base64');
  const params = {
    host: host.ip,
    port: cred.port || 5985,
    path: '/wsman',
    auth,
  };
  try {
    const shellId = await winrm.shell.doCreateShell(params);
    params.shellId = shellId;
    const runCmd = async (command) => {
      const p = { ...params, command };
      const commandId = await winrm.command.doExecuteCommand(p);
      p.commandId = commandId;
      const output = await winrm.command.doReceiveOutput(p);
      return (output || '').toString().trim();
    };
    const data = {};
    data.hostname = await runCmd('hostname');
    data.serial = (await runCmd('wmic bios get serialnumber')).split(/\r?\n/).pop().trim();
    data.model = (await runCmd('wmic computersystem get model')).split(/\r?\n/).pop().trim();
    data.vendor = (await runCmd('wmic computersystem get manufacturer')).split(/\r?\n/).pop().trim();
    data.os = (await runCmd('wmic os get caption')).split(/\r?\n/).pop().trim();
    try { await winrm.shell.doDeleteShell(params); } catch (_) {}
    for (const k of Object.keys(data)) {
      const v = (data[k] || '').trim();
      if (!v || /serialnumber|model|manufacturer|caption/i.test(v)) delete data[k];
      else data[k] = v;
    }
    return Object.keys(data).length
      ? { data, error: null }
      : { data: null, error: 'winrm sin datos utiles' };
  } catch (e) {
    return { data: null, error: (e && e.message ? e.message : String(e)).slice(0, 200) };
  }
}

// ───────────────────────────────────────────────────────── normalizacion ────

function guessCategory(host, enrich) {
  const os = ((enrich && enrich.os) || host.os || '').toLowerCase();
  const services = host.ports.map((p) => p.service || '').join(' ').toLowerCase();
  const vendor = (host.vendor || (enrich && enrich.vendor) || '').toLowerCase();
  const portSet = new Set(host.ports.map((p) => p.port));
  if (portSet.has(9100) || services.includes('printer') || services.includes('jetdirect') ||
      /hp|epson|brother|canon|lexmark|kyocera|ricoh|xerox/.test(vendor)) return 'printer';
  if (os.includes('windows server')) return 'server';
  if (os.includes('windows')) return 'desktop';
  if (os.includes('linux') || os.includes('unix') || os.includes('bsd')) return 'server';
  if (services.includes('ssh') && !os.includes('windows')) return 'server';
  return 'other';
}

function buildResult(host, enrich, method) {
  const e = enrich || {};
  return {
    ip: host.ip,
    mac: host.mac || null,
    hostname: e.hostname || host.hostname || null,
    vendor: host.vendor || e.vendor || null,
    os: e.os || host.os || null,
    open_ports: host.ports
      .map((p) => p.port + (p.service ? '/' + p.service : ''))
      .join(', '),
    serial_number: e.serial || null,
    brand: e.vendor || host.vendor || null,
    model: e.model || null,
    category: guessCategory(host, enrich),
    enrich_method: method,
    raw: { host, enrich: e },
  };
}

// ───────────────────────────────────────────────────────────── principal ────

// Escanea un rango y devuelve resultados normalizados.
// credentials: filas de scan_credentials (con secret_encrypted), ya ordenadas
// por prioridad ascendente.
async function scanNetwork(network, credentials) {
  const xml = await runNmap(network.cidr);
  const hosts = parseNmapXml(xml);
  const results = [];

  for (const host of hosts) {
    const openPorts = new Set(host.ports.map((p) => p.port));
    const hasWinPort = [135, 139, 445, 3389, 5985].some((p) => openPorts.has(p));
    const attempts = []; // [{ method, ok, error, cred }]
    let enrich = null;
    let method = null;

    // Helper: ejecuta un enriquecimiento y registra el intento.
    // fn debe devolver el objeto de datos o { data, error } (o null).
    const tryEnrich = async (m, credLabel, fn) => {
      let data = null, error = null;
      try {
        const r = await fn();
        if (r && typeof r === 'object' && ('data' in r || 'error' in r)) {
          data = r.data; error = r.error;
        } else {
          data = r;
        }
      } catch (e) {
        error = (e && e.message) ? e.message : String(e);
      }
      attempts.push({
        method: m,
        cred: credLabel,
        ok: !!(data && Object.keys(data).length),
        error: error ? String(error).slice(0, 200) : (data ? null : 'sin datos'),
      });
      return data && Object.keys(data).length ? data : null;
    };

    for (const cred of credentials) {
      if (enrich) break;
      const credLabel = cred.label || `${cred.type}#${cred.id}`;
      let secret = null;
      try { secret = cred.secret_encrypted ? decrypt(cred.secret_encrypted) : null; } catch (_) { secret = null; }

      if (cred.type === 'ssh' && openPorts.has(cred.port || 22)) {
        enrich = await tryEnrich('ssh', credLabel, () => sshEnrich(host, cred, secret));
        if (enrich) method = 'ssh';
      } else if (cred.type === 'snmp') {
        enrich = await tryEnrich('snmp', credLabel, () => snmpEnrich(host, cred, secret));
        if (enrich) method = 'snmp';
      } else if (cred.type === 'winrm' && hasWinPort) {
        // Orden para Windows: WMI -> SMB-NSE -> WinRM.
        if (openPorts.has(135) || openPorts.has(445)) {
          enrich = await tryEnrich('wmi', credLabel, () => wmiEnrich(host, cred, secret));
          if (enrich) method = 'wmi';
        } else {
          attempts.push({ method: 'wmi', cred: credLabel, ok: false, error: 'puerto 135/445 cerrado' });
        }
        if (!enrich && (openPorts.has(445) || openPorts.has(139))) {
          enrich = await tryEnrich('smb', credLabel, () => smbNmapEnrich(host, cred, secret));
          if (enrich) method = 'smb';
        }
        if (!enrich && openPorts.has(cred.port || 5985)) {
          enrich = await tryEnrich('winrm', credLabel, () => winrmEnrich(host, cred, secret));
          if (enrich) method = 'winrm';
        } else if (!enrich && !openPorts.has(cred.port || 5985)) {
          attempts.push({ method: 'winrm', cred: credLabel, ok: false, error: 'puerto 5985 cerrado' });
        }
      }
    }

    // Fallback anonimo: smb-os-discovery sin credenciales.
    if (!enrich && hasWinPort && (openPorts.has(445) || openPorts.has(139))) {
      enrich = await tryEnrich('smb-anon', '-', () => smbNmapEnrich(host, null, null));
      if (enrich) method = 'smb-anon';
    }

    const result = buildResult(host, enrich, method);
    // Guardar diagnostico para mostrar en la UI.
    result.raw = { ...(result.raw || {}), attempts };
    results.push(result);
  }

  return results;
}

module.exports = { scanNetwork, runNmap, parseNmapXml };
