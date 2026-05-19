const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db');
const { authenticate, requireEditor } = require('../middleware/auth');

// Directorio de uploads
const UPLOAD_DIR = '/app/uploads';
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ALLOWED_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'text/plain',
  'application/zip', 'application/x-zip-compressed',
];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`Tipo de archivo no permitido: ${file.mimetype}`));
  },
});

// GET /api/documents/:assetId — listar documentos de un activo
router.get('/:assetId', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.id, d.asset_id, d.filename, d.original_name, d.mimetype, d.size, d.created_at,
              u.full_name AS uploaded_by_name
       FROM asset_documents d
       LEFT JOIN users u ON u.id = d.uploaded_by
       WHERE d.asset_id = $1
       ORDER BY d.created_at DESC`,
      [req.params.assetId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener documentos' });
  }
});

// POST /api/documents/:assetId — subir documento a un activo
router.post('/:assetId', authenticate, requireEditor, (req, res) => {
  upload.single('document')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE')
        return res.status(400).json({ error: 'El archivo supera el límite de 20 MB' });
      return res.status(400).json({ error: err.message });
    }
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No se ha subido ningún archivo' });

    try {
      // Verificar que el activo existe
      const assetCheck = await pool.query('SELECT id FROM assets WHERE id = $1', [req.params.assetId]);
      if (assetCheck.rows.length === 0) {
        fs.unlinkSync(req.file.path);
        return res.status(404).json({ error: 'Activo no encontrado' });
      }

      const { rows } = await pool.query(
        `INSERT INTO asset_documents (asset_id, filename, original_name, mimetype, size, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [req.params.assetId, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, req.user.id]
      );

      res.status(201).json({ ...rows[0], uploaded_by_name: req.user.full_name });
    } catch (dbErr) {
      if (req.file) fs.unlinkSync(req.file.path);
      console.error(dbErr);
      res.status(500).json({ error: 'Error al guardar el documento' });
    }
  });
});

// GET /api/documents/download/:id — descargar documento
router.get('/download/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM asset_documents WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Documento no encontrado' });
    const doc = rows[0];
    const filePath = path.join(UPLOAD_DIR, doc.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no encontrado en el servidor' });
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.original_name)}"`);
    res.setHeader('Content-Type', doc.mimetype);
    res.sendFile(filePath);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al descargar el documento' });
  }
});

// DELETE /api/documents/file/:id — eliminar documento
router.delete('/file/:id', authenticate, requireEditor, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM asset_documents WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Documento no encontrado' });

    if (req.user.role !== 'admin' && rows[0].uploaded_by !== req.user.id)
      return res.status(403).json({ error: 'Sin permisos para eliminar este documento' });

    const doc = rows[0];
    await pool.query('DELETE FROM asset_documents WHERE id = $1', [req.params.id]);

    const filePath = path.join(UPLOAD_DIR, doc.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    res.json({ message: 'Documento eliminado correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar el documento' });
  }
});

module.exports = router;
