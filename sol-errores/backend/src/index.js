require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { pool } = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Servir archivos subidos estáticamente
app.use('/uploads', require('./middleware/auth').authenticate, express.static('/app/uploads'));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/assets', require('./routes/assets'));
app.use('/api/users', require('./routes/users'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/software', require('./routes/software'));
app.use('/api/floorplan', require('./routes/floorplan-images'));
app.use('/api/floorplan', require('./routes/floorplan'));
app.use('/api/client-users', require('./routes/client-users'));

// 404
app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// Error handler
app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// Init DB and start server
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        full_name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin','editor','viewer')),
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS assets (
        id VARCHAR(50) PRIMARY KEY,
        serial_number VARCHAR(100) NOT NULL,
        category VARCHAR(30) NOT NULL DEFAULT 'other',
        brand VARCHAR(100) NOT NULL,
        model VARCHAR(150) NOT NULL,
        price NUMERIC(12,2) NOT NULL DEFAULT 0,
        purchase_date DATE,
        purchase_order VARCHAR(100),
        assigned_to VARCHAR(150),
        status VARCHAR(20) NOT NULL DEFAULT 'activo' CHECK (status IN ('activo','inactivo','reparacion','baja')),
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_serial ON assets(serial_number);

      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        value VARCHAR(50) UNIQUE NOT NULL,
        label VARCHAR(100) NOT NULL,
        icon VARCHAR(50),
        is_system BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS client_users (
        id SERIAL PRIMARY KEY,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        email VARCHAR(150),
        phone VARCHAR(50),
        department VARCHAR(100),
        position VARCHAR(100),
        employee_id VARCHAR(50) UNIQUE,
        notes TEXT,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS software (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        vendor VARCHAR(150) NOT NULL,
        version VARCHAR(50) NOT NULL DEFAULT '',
        license_key TEXT,
        license_type VARCHAR(30) NOT NULL DEFAULT 'perpetua'
          CHECK (license_type IN ('perpetua','suscripcion','freeware','opensource','trial','volumen')),
        seats INTEGER NOT NULL DEFAULT 1,
        purchase_date DATE,
        expiry_date DATE,
        purchase_order VARCHAR(100),
        price NUMERIC(12,2) NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'activo'
          CHECK (status IN ('activo','inactivo','expirado','baja')),
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS software_asset_links (
        id SERIAL PRIMARY KEY,
        software_id INTEGER NOT NULL REFERENCES software(id) ON DELETE CASCADE,
        asset_id VARCHAR(50) NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        notes TEXT,
        assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(software_id, asset_id)
      );

      CREATE TABLE IF NOT EXISTS software_user_links (
        id SERIAL PRIMARY KEY,
        software_id INTEGER NOT NULL REFERENCES software(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES client_users(id) ON DELETE CASCADE,
        notes TEXT,
        assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS asset_documents (
        id SERIAL PRIMARY KEY,
        asset_id VARCHAR(50) NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        filename VARCHAR(255) NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        mimetype VARCHAR(100) NOT NULL,
        size INTEGER NOT NULL,
        uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_asset_documents_id ON asset_documents(asset_id);

      CREATE TABLE IF NOT EXISTS asset_user_links (
        id SERIAL PRIMARY KEY,
        asset_id VARCHAR(50) NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        client_user_id INTEGER NOT NULL REFERENCES client_users(id) ON DELETE CASCADE,
        link_type VARCHAR(30) NOT NULL DEFAULT 'asignado' CHECK (link_type IN ('asignado','responsable','usuario_secundario')),
        notes TEXT,
        assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(asset_id, client_user_id)
      );

      CREATE TABLE IF NOT EXISTS floorplan_items (
        id SERIAL PRIMARY KEY,
        floor INTEGER NOT NULL DEFAULT 0,
        x FLOAT NOT NULL DEFAULT 0,
        y FLOAT NOT NULL DEFAULT 0,
        width FLOAT NOT NULL DEFAULT 120,
        height FLOAT NOT NULL DEFAULT 80,
        type VARCHAR(30) NOT NULL DEFAULT 'room',
        label VARCHAR(150) NOT NULL DEFAULT 'Elemento',
        color VARCHAR(20) NOT NULL DEFAULT '#3b82f6',
        asset_id VARCHAR(50) REFERENCES assets(id) ON DELETE SET NULL,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Create default admin if no users exist
    const { rows } = await client.query('SELECT COUNT(*) FROM users');
    if (parseInt(rows[0].count) === 0) {
      const bcrypt = require('bcryptjs');
      const hash = await bcrypt.hash('Admin1234!', 12);
      await client.query(
        `INSERT INTO users (username, full_name, email, password_hash, role, active)
         VALUES ('admin', 'Administrador', 'admin@inventarioit.local', $1, 'admin', true)`,
        [hash]
      );
      console.log('✅ Usuario admin creado: admin / Admin1234!');
    }

    // Insert default categories if none exist
    const { rows: catRows } = await client.query('SELECT COUNT(*) FROM categories');
    if (parseInt(catRows[0].count) === 0) {
      const defaultCats = [
        ['laptop',     'Portátil',    '💻', true],
        ['desktop',    'Sobremesa',   '🖥️', true],
        ['monitor',    'Monitor',     '🖵',  true],
        ['printer',    'Impresora',   '🖨️', true],
        ['switch',     'Switch',      '🔀', true],
        ['router',     'Router',      '📡', true],
        ['server',     'Servidor',    '🗄️', true],
        ['tablet',     'Tablet',      '📱', true],
        ['smartphone', 'Smartphone',  '📲', true],
        ['peripheral', 'Periférico',  '🖱️', true],
        ['ups',        'SAI/UPS',     '🔋', true],
        ['other',      'Otro',        '📦', true],
      ];
      for (const [value, label, icon, is_system] of defaultCats) {
        await client.query(
          `INSERT INTO categories (value, label, icon, is_system) VALUES ($1,$2,$3,$4) ON CONFLICT (value) DO NOTHING`,
          [value, label, icon, is_system]
        );
      }
      console.log('✅ Categorías por defecto creadas');
    }

    console.log('✅ Base de datos inicializada correctamente');
  } finally {
    client.release();
  }
}

initDB()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ Error al inicializar la base de datos:', err);
    process.exit(1);
  });
