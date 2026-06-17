// Scheduler: ejecuta escaneos programados (cron) y envia email cuando
// encuentra equipos NUEVOS (no inventariados aun).
const cron = require('node-cron');
const { pool } = require('./db');
const { scanNetwork } = require('./scanner');
const { sendMail } = require('./email');

const tasks = new Map(); // schedule_id -> cron task

async function loadCredsForNetwork(networkId) {
  // IMPORTANTE: devolvemos las filas TAL CUAL (con `secret_encrypted`), porque
  // scanner.js espera ese campo y se encarga internamente de descifrar. Si
  // descifraramos aqui y renombraramos a `secret`, el scanner no encontraria
  // `secret_encrypted` y enviaria password vacio -> rpc_s_access_denied / 401.
  const { rows } = await pool.query(
    'SELECT * FROM scan_credentials WHERE network_id=$1 ORDER BY priority ASC, id ASC',
    [networkId]
  );
  return rows;
}

async function runSchedule(schedule) {
  console.log(`[scheduler] Ejecutando schedule ${schedule.id} (${schedule.name})`);
  const jobIns = await pool.query(
    `INSERT INTO scan_jobs (network_id, status, started_at, schedule_id)
     VALUES ($1, 'running', NOW(), $2) RETURNING id`,
    [schedule.network_id, schedule.id]
  );
  const jobId = jobIns.rows[0].id;
  await pool.query(
    'UPDATE scan_schedules SET last_run_at=NOW(), last_run_job_id=$1 WHERE id=$2',
    [jobId, schedule.id]
  );

  try {
    const { rows: nets } = await pool.query('SELECT * FROM scan_networks WHERE id=$1', [schedule.network_id]);
    if (nets.length === 0) throw new Error('Red no encontrada');
    const net = nets[0];
    if (!net.enabled) throw new Error('Red deshabilitada');
    const credentials = await loadCredsForNetwork(schedule.network_id);

    const results = await scanNetwork(net, credentials);

    const newOnes = [];
    for (const r of results) {
      let matched = null;
      if (r.serial_number) {
        const m = await pool.query('SELECT id FROM assets WHERE serial_number=$1 LIMIT 1', [r.serial_number]);
        if (m.rows.length > 0) matched = m.rows[0].id;
      }
      if (!matched) newOnes.push(r);
      await pool.query(
        `INSERT INTO scan_results
           (job_id, ip, mac, hostname, vendor, os, open_ports, serial_number, brand, model, category, enrich_method, raw, matched_asset_id, system_info, software)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [jobId, r.ip, r.mac, r.hostname, r.vendor, r.os, r.open_ports,
         r.serial_number, r.brand, r.model, r.category || 'other',
         r.enrich_method, JSON.stringify(r.raw || {}), matched,
         r.system_info ? JSON.stringify(r.system_info) : null,
         Array.isArray(r.software) ? JSON.stringify(r.software) : null]
      );
      // Si el equipo ya estaba inventariado (matched) y trae bloque
      // system_info, refrescamos asset_system_info preservando las notas
      // manuales del usuario (mismo upsert que usa scan.js manual).
      // No pisar datos del agente si el activo esta gestionado por uno.
      let skipAgentManaged = false;
      if (matched) {
        try {
          const mng = await pool.query(
            `SELECT 1 FROM agent_devices WHERE asset_id=$1 AND status='active' LIMIT 1`,
            [matched]
          );
          skipAgentManaged = mng.rowCount > 0;
          if (skipAgentManaged) {
            console.log(`[scheduler] ${matched} gestionado por agente, no se sobreescribe asset_system_info/software`);
          }
        } catch (_) {}
      }
      if (matched && r.system_info && !skipAgentManaged) {
        try {
          await pool.query(
            `INSERT INTO asset_system_info (asset_id, scanned_data, scanned_at, source, updated_at)
             VALUES ($1, $2, NOW(), $3, NOW())
             ON CONFLICT (asset_id) DO UPDATE SET
               scanned_data = EXCLUDED.scanned_data,
               scanned_at   = EXCLUDED.scanned_at,
               source       = EXCLUDED.source,
               updated_at   = NOW()`,
            [matched, JSON.stringify(r.system_info), r.enrich_method || null]
          );
        } catch (e) {
          console.warn('[scheduler] asset_system_info upsert fallo:', e.message);
        }
      }
      // Refresca la lista de software instalado del activo (si emparejado).
      if (matched && Array.isArray(r.software) && r.software.length && !skipAgentManaged) {
        try {
          await pool.query(
            `INSERT INTO asset_software (asset_id, software, scanned_at, source, updated_at)
             VALUES ($1, $2, NOW(), $3, NOW())
             ON CONFLICT (asset_id) DO UPDATE SET
               software   = EXCLUDED.software,
               scanned_at = EXCLUDED.scanned_at,
               source     = EXCLUDED.source,
               updated_at = NOW()`,
            [matched, JSON.stringify(r.software), r.enrich_method || null]
          );
        } catch (e) {
          console.warn('[scheduler] asset_software upsert fallo:', e.message);
        }
      }
    }
    await pool.query(
      `UPDATE scan_jobs SET status='completed', finished_at=NOW(), hosts_found=$1 WHERE id=$2`,
      [results.length, jobId]
    );

    if (newOnes.length > 0) {
      const emails = Array.isArray(schedule.notify_emails) ? schedule.notify_emails : [];
      if (emails.length > 0) {
        try {
          const subject = `[Inventario] ${newOnes.length} equipo(s) NUEVO(s) en "${schedule.name}"`;
          const lines = newOnes.slice(0, 50).map((r) => {
            const brand = r.brand || r.vendor || '';
            const model = r.model || '';
            const sn = r.serial_number ? ` · S/N: ${r.serial_number}` : '';
            const host = r.hostname ? ` · ${r.hostname}` : '';
            return `  • ${r.ip}${host} — ${brand} ${model}${sn}`.trim();
          }).join('\n');
          const extra = newOnes.length > 50 ? `\n  ... y ${newOnes.length - 50} mas` : '';
          const text = `El escaneo programado "${schedule.name}" (red ${net.name} ${net.cidr}) ha encontrado ${newOnes.length} equipo(s) que NO estan en el inventario:\n\n${lines}${extra}\n\nRevisalos en la pagina de Descubrimiento para importarlos.`;
          await sendMail({ to: emails, subject, text });
          console.log(`[scheduler] Email enviado a ${emails.length} destinatario(s)`);
        } catch (mailErr) {
          console.warn('[scheduler] Email fallo:', mailErr.message);
        }
      }
    }
    console.log(`[scheduler] Schedule ${schedule.id} OK: ${results.length} equipos, ${newOnes.length} nuevos`);
  } catch (err) {
    console.error('[scheduler] Error en schedule', schedule.id, err);
    try {
      await pool.query(
        `UPDATE scan_jobs SET status='failed', finished_at=NOW(), error=$1 WHERE id=$2`,
        [String(err.message || err).slice(0, 500), jobId]
      );
    } catch (_) {}
  }
}

function unregister(scheduleId) {
  const t = tasks.get(scheduleId);
  if (t) { try { t.stop(); } catch (_) {} tasks.delete(scheduleId); }
}

function register(schedule) {
  unregister(schedule.id);
  if (!schedule.enabled || !schedule.cron_expr) return;
  if (!cron.validate(schedule.cron_expr)) {
    console.warn('[scheduler] cron invalido para', schedule.id, schedule.cron_expr);
    return;
  }
  const task = cron.schedule(
    schedule.cron_expr,
    () => { runSchedule(schedule).catch((e) => console.error('[scheduler]', e)); },
    { scheduled: true, timezone: schedule.timezone || 'Europe/Madrid' }
  );
  tasks.set(schedule.id, task);
  console.log(`[scheduler] Registrado schedule ${schedule.id} (${schedule.name}) cron "${schedule.cron_expr}"`);
}

async function reloadAll() {
  try {
    const { rows } = await pool.query('SELECT * FROM scan_schedules');
    const ids = new Set(rows.map((r) => r.id));
    for (const id of Array.from(tasks.keys())) {
      if (!ids.has(id)) unregister(id);
    }
    for (const s of rows) register(s);
  } catch (err) {
    console.error('[scheduler] reloadAll error:', err.message);
  }
}

function init() {
  // Pequena espera para que la BD termine de crear tablas
  setTimeout(() => {
    reloadAll().catch((err) => console.error('[scheduler] init error', err));
  }, 2000);
}

module.exports = { init, register, unregister, reloadAll, runSchedule };
