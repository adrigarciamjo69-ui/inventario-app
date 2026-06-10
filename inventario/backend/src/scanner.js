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
 *   - nodejs-winrm    -> enriquecimiento WinRM (Windows)
 *
 * Si alguna pieza no esta disponible, el escaneo degrada con elegancia: se
 * devuelven los datos que se hayan podido obtener y nunca se lanza una
 * excepcion por falta de un modulo opcional.
 */
const { spawn } = require('child_process');
const { decrypt } = require('./crypto');

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
  if (!ssh2 || !ssh2.Client) return Promise.resolve(null);
  return new Promise((resolve) => {
    const conn = new ssh2.Client();
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      try { conn.end(); } catch (_) {}
      resolve(val);
    };
    const timer = setTimeout(() => finish(null), 18000);
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
        finish(Object.keys(data).length ? data : null);
      } catch (_) {
        clearTimeout(timer);
        finish(null);
      }
    });
    conn.on('error', () => { clearTimeout(timer); finish(null); });
    try {
      conn.connect({
        host: host.ip,
        port: cred.port || 22,
        username: cred.username || 'root',
        password: secret || undefined,
        readyTimeout: 12000,
        // Algunos equipos antiguos requieren algoritmos heredados; ssh2 los
        // negocia automaticamente, pero limitamos el tiempo de espera.
      });
    } catch (_) {
      clearTimeout(timer);
      finish(null);
    }
  });
}

// ────────────────────────────────────────────────── enriquecimiento SNMP ────

function snmpEnrich(host, cred, secret) {
  const snmp = tryRequire('net-snmp');
  if (!snmp) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    let session;
    const finish = (v) => {
      if (done) return;
      done = true;
      try { session && session.close(); } catch (_) {}
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), 9000);
    try {
      const community = secret || cred.username || 'public';
      session = snmp.createSession(host.ip, community, { timeout: 4000, retries: 1 });
      // sysName (1.3.6.1.2.1.1.5.0) y sysDescr (1.3.6.1.2.1.1.1.0)
      const oids = ['1.3.6.1.2.1.1.5.0', '1.3.6.1.2.1.1.1.0'];
      session.get(oids, (error, varbinds) => {
        clearTimeout(timer);
        if (error) return finish(null);
        const data = {};
        try {
          if (varbinds[0] && !snmp.isVarbindError(varbinds[0])) data.hostname = varbinds[0].value.toString();
          if (varbinds[1] && !snmp.isVarbindError(varbinds[1])) data.os = varbinds[1].value.toString();
        } catch (_) {}
        finish(Object.keys(data).length ? data : null);
      });
    } catch (_) {
      clearTimeout(timer);
      finish(null);
    }
  });
}

// ───────────────────────────────────────────────── enriquecimiento WinRM ────
// Best-effort: la API de nodejs-winrm varia entre versiones, por lo que se
// comprueba que existan los metodos esperados antes de usarlos. Cualquier
// fallo devuelve null sin romper el escaneo.

async function winrmEnrich(host, cred, secret) {
  const winrm = tryRequire('nodejs-winrm');
  if (!winrm || !winrm.shell || !winrm.command) return null;
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
    return Object.keys(data).length ? data : null;
  } catch (_) {
    return null;
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
    let enrich = null;
    let method = null;

    for (const cred of credentials) {
      let secret = null;
      try { secret = cred.secret_encrypted ? decrypt(cred.secret_encrypted) : null; } catch (_) { secret = null; }
      try {
        if (cred.type === 'ssh' && (openPorts.has(cred.port || 22) || openPorts.has(22))) {
          enrich = await sshEnrich(host, cred, secret);
        } else if (cred.type === 'snmp') {
          enrich = await snmpEnrich(host, cred, secret);
        } else if (cred.type === 'winrm' && (openPorts.has(cred.port || 5985) || openPorts.has(5985))) {
          enrich = await winrmEnrich(host, cred, secret);
        }
      } catch (_) {
        enrich = null;
      }
      if (enrich && Object.keys(enrich).length) { method = cred.type; break; }
    }

    results.push(buildResult(host, enrich, method));
  }

  return results;
}

module.exports = { scanNetwork, runNmap, parseNmapXml };
