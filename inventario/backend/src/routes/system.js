const router = require('express').Router();
const { pool } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { exec } = require('child_process');

function getDiskUsage() {
  return new Promise((resolve) => {
    exec("df -B1 / | tail -1", (err, stdout) => {
      if (err) { resolve(null); return; }
      try {
        const parts = stdout.trim().split(/\s+/);
        resolve({
          total:     parseInt(parts[1]) || 0,
          used:      parseInt(parts[2]) || 0,
          available: parseInt(parts[3]) || 0,
          pct_used:  parseInt(parts[4]) || 0,
        });
      } catch { resolve(null); }
    });
  });
}

router.get('/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const disk = await getDiskUsage();
    const { rows: tables } = await pool.query(`
      SELECT
        relname                                        AS table_name,
        pg_total_relation_size(relid)                  AS size_bytes,
        pg_relation_size(relid)                        AS data_bytes,
        pg_total_relation_size(relid)
          - pg_relation_size(relid)                    AS index_bytes,
        COALESCE(n_live_tup, 0)                       AS row_count,
        pg_size_pretty(pg_total_relation_size(relid))  AS size_pretty
      FROM pg_stat_user_tables
      ORDER BY pg_total_relation_size(relid) DESC
    `);
    const { rows: dbSize } = await pool.query(`
      SELECT pg_database_size(current_database()) AS total_bytes,
             pg_size_pretty(pg_database_size(current_database())) AS total_pretty
    `);
    res.json({
      disk,
      db: {
        total_bytes:  parseInt(dbSize[0].total_bytes),
        total_pretty: dbSize[0].total_pretty,
        tables: tables.map(t => ({
          table_name:  t.table_name,
          size_bytes:  parseInt(t.size_bytes),
          data_bytes:  parseInt(t.data_bytes),
          index_bytes: parseInt(t.index_bytes),
          row_count:   parseInt(t.row_count),
          size_pretty: t.size_pretty,
        })),
      },
    });
  } catch (err) {
    console.error('[system/stats]', err);
    res.status(500).json({ error: 'Error al obtener estadísticas del sistema' });
  }
});

module.exports = router;
