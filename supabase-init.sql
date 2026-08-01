-- Supabase init: run this in the SQL Editor if tables don't auto-create
-- (Normally initAllTables() in index.js creates them on boot)

CREATE TABLE IF NOT EXISTS resultados (
  id SERIAL PRIMARY KEY,
  fuente VARCHAR(50) NOT NULL,
  fecha VARCHAR(10) NOT NULL,
  hora VARCHAR(10) NOT NULL,
  datos JSONB,
  estado VARCHAR(20) DEFAULT 'completed',
  actualizado TIMESTAMP DEFAULT NOW(),
  UNIQUE(fuente, fecha, hora)
);

CREATE TABLE IF NOT EXISTS inh_programa (
  id SERIAL PRIMARY KEY,
  fecha VARCHAR(10) NOT NULL UNIQUE,
  datos JSONB,
  actualizado TIMESTAMP DEFAULT NOW()
);

-- Disable RLS so the direct postgres role and future service_role both work
ALTER TABLE resultados ENABLE ROW LEVEL SECURITY;
ALTER TABLE inh_programa ENABLE ROW LEVEL SECURITY;

-- Grant access to all roles (anon, authenticated, service_role)
ALTER TABLE resultados ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow all" ON resultados FOR ALL USING (true) WITH CHECK (true);
ALTER TABLE inh_programa ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow all" ON inh_programa FOR ALL USING (true) WITH CHECK (true);
