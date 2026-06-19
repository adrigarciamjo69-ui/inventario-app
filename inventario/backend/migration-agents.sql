-- ============================================================================
-- Migracion: modo AGENTE (push) para delegaciones.
-- Pega este bloque dentro del mismo string de creacion de tablas en
-- backend/src/index.js (junto a scan_networks / scan_jobs / scan_results), o
-- ejecutalo una vez contra la BD. Todo es idempotente (IF NOT EXISTS).
-- ============================================================================

-- Un agente = un equipo (o una delegacion) que empuja informes por HTTPS.
-- El token nunca se guarda en claro: solo su SHA-256.
CREATE TABLE IF NOT EXISTS scan_agents (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(150) NOT NULL,
  delegation   VARCHAR(150),
  os           VARCHAR(20),                      -- 'windows' | 'linux'
  network_id   INTEGER REFERENCES scan_networks(id) ON DELETE SET NULL,
  token_hash   TEXT NOT NULL,
  enabled      BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_agents_token ON scan_agents(token_hash);

-- Vincula cada job al agente que lo genero (los escaneos de red lo dejan NULL).
ALTER TABLE scan_jobs ADD COLUMN IF NOT EXISTS agent_id INTEGER
  REFERENCES scan_agents(id) ON DELETE SET NULL;
