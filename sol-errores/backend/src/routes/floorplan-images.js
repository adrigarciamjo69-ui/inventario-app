/**
 * Rutas para gestionar imágenes de fondo de las plantas del mapa.
 * Cada planta (floor 0, 1, ...) puede tener una imagen de plano.
 */

const router   = require('express').Router();
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db');
const { authenticate, requireEditor } = require('../middleware/auth');

const UPLOAD_DIR = '/app/uploads/floorplans';
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ALLOWED_IMAGE_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'image/svg+xml', 'image/bmp', 'image/tiff',
];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    cb(null, `floor_${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`Tipo no permitido: ${file.mimetype}. Solo se admiten imágenes.`));
  },
});

// Asegurar tabla en BD
async function ensureTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS floorplan_images (
      id      SERIAL PRIMARY KEY,
      floor   INTEGER UNIQUE NOT NULL,
      filename VARCHAR(255) NOT NULL,
      url     VARCHAR(500) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

// ── GET /api/floorplan/images — listar imágenes de todas las plantas ──────────
router.get('/images', authenticate, async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureTable(client);
    const { rows } = await client.query(
      'SELECT floor, url FROM floorplan_images ORDER BY floor'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener imágenes de planta' });
  } finally {
    client.release();
  }
});

// ── POST /api/floorplan/image — subir o reemplazar imagen de una planta ───────
router.post('/image', authenticate, requireEditor, (req, res) => {
  upload.single('image')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE')
        return res.status(400).json({ error: 'La imagen supera el límite de 20 MB' });
      return res.status(400).json({ error: err.message });
    }
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No se ha enviado ninguna imagen' });

    const floor = parseInt(req.body.floor);
    if (isNaN(floor) || floor < 0) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Número de planta no válido' });
    }

    const client = await pool.connect();
    try {
      await ensureTable(client);

      // Si ya había imagen, borrar el archivo anterior
      const existing = await client.query(
        'SELECT filename FROM floorplan_images WHERE floor = $1', [floor]
      );
      if (existing.rows.length > 0) {
        const oldFile = path.join(UPLOAD_DIR, existing.rows[0].filename);
        if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
      }

      const url = `/api/floorplan/image-file/${req.file.filename}`;

      const { rows } = await client.query(
        `INSERT INTO floorplan_images (floor, filename, url)
         VALUES ($1, $2, $3)
         ON CONFLICT (floor) DO UPDATE
           SET filename=$2, url=$3, updated_at=NOW()
         RETURNING floor, url`,
        [floor, req.file.filename, url]
      );

      res.status(201).json(rows[0]);
    } catch (dbErr) {
      if (req.file) fs.unlinkSync(req.file.path);
      console.error(dbErr);
      res.status(500).json({ error: 'Error al guardar la imagen en la base de datos' });
    } finally {
      client.release();
    }
  });
});

// ── GET /api/floorplan/image-file/:filename — servir el archivo de imagen ─────
router.get('/image-file/:filename', (req, res) => {
  const filename = path.basename(req.params.filename); // evita path traversal
  const filePath = path.join(UPLOAD_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Imagen no encontrada' });
  }

  // Detectar tipo MIME por extensión
  const ext = path.extname(filename).toLowerCase();
  const mimeMap = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.gif': 'image/gif',
    '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp', '.tiff': 'image/tiff',
  };
  const mime = mimeMap[ext] || 'application/octet-stream';

  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(filePath);
});

// ── DELETE /api/floorplan/image/:floor — eliminar imagen de una planta ────────
router.delete('/image/:floor', authenticate, requireEditor, async (req, res) => {
  const floor = parseInt(req.params.floor);
  if (isNaN(floor)) return res.status(400).json({ error: 'Número de planta no válido' });

  const client = await pool.connect();
  try {
    await ensureTable(client);
    const { rows } = await client.query(
      'SELECT filename FROM floorplan_images WHERE floor = $1', [floor]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'No hay imagen para esta planta' });

    const filePath = path.join(UPLOAD_DIR, rows[0].filename);
    await client.query('DELETE FROM floorplan_images WHERE floor = $1', [floor]);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    res.json({ message: 'Imagen eliminada correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar la imagen' });
  } finally {
    client.release();
  }
});

module.exports = router;
