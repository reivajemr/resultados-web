import pg from 'pg';

const ssl = { rejectUnauthorized: false };

function looksLikeValidHost(host) {
  if (!host) return false;
  if (host === 'localhost' || host === '127.0.0.1') return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes('.');
}

function makePool() {
  const raw = process.env.DATABASE_URL;
  let useUrl = false;

  if (raw) {
    try {
      const u = new URL(raw);
      if (looksLikeValidHost(u.hostname)) {
        useUrl = true;
        console.log(`[DB] Conectando a host=${u.hostname} port=${u.port || '5432'} user=${u.username || '?'} db=${(u.pathname || '/postgres').slice(1)}`);
      } else {
        console.warn(`[DB] DATABASE_URL host "${u.hostname}" parece inválido; usaré env vars individuales si están disponibles`);
      }
    } catch (e) {
      console.error('[DB] DATABASE_URL no es una URL válida:', e.message);
    }
  }

  if (useUrl) {
    return new pg.Pool({
      connectionString: raw,
      ssl: raw.includes('localhost') ? false : ssl
    });
  }

  if (process.env.PGHOST || process.env.PGPASSWORD || process.env.PGDATABASE) {
    console.log(`[DB] Usando env vars individuales (PGHOST=${process.env.PGHOST || 'no definido'})`);
    return new pg.Pool({ ssl });
  }

  console.log('[DB] Sin configuración de DB — datos solo en memoria');
  return null;
}

const pool = makePool();

if (pool) {
  pool.on('error', (err) => {
    console.error('[DB] Error en pool:', err.message);
  });
}

function mustPool() {
  if (!pool) throw new Error('Base de datos no configurada');
  return pool;
}

export async function initDB() {
  const client = await mustPool().connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS resultados (
        id SERIAL PRIMARY KEY,
        fuente VARCHAR(50) NOT NULL,
        fecha VARCHAR(10) NOT NULL,
        hora VARCHAR(10) NOT NULL,
        datos JSONB,
        estado VARCHAR(20) DEFAULT 'completed',
        actualizado TIMESTAMP DEFAULT NOW(),
        UNIQUE(fuente, fecha, hora)
      )
    `);
    console.log('[DB] Tabla creada/verificada');
  } finally {
    client.release();
  }
}

export async function guardarResultado(fuente, fecha, hora, datos, estado = 'completed') {
  const client = await mustPool().connect();
  try {
    await client.query(
      `INSERT INTO resultados (fuente, fecha, hora, datos, estado, actualizado)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (fuente, fecha, hora)
       DO UPDATE SET datos = $4, estado = $5, actualizado = NOW()`,
      [fuente, fecha, hora, JSON.stringify(datos), estado]
    );
  } finally {
    client.release();
  }
}

export async function cargarResultados(fuente, fecha) {
  const client = await mustPool().connect();
  try {
    const { rows } = await client.query(
      `SELECT hora, datos, estado FROM resultados
       WHERE fuente = $1 AND fecha = $2
       ORDER BY hora`,
      [fuente, fecha]
    );
    return rows;
  } finally {
    client.release();
  }
}

export async function guardarProgramaINH(fecha, programa) {
  const client = await mustPool().connect();
  try {
    await client.query(
      `INSERT INTO inh_programa (fecha, datos, actualizado)
       VALUES ($1, $2, NOW())
       ON CONFLICT (fecha)
       DO UPDATE SET datos = $2, actualizado = NOW()`,
      [fecha, JSON.stringify(programa)]
    );
  } finally {
    client.release();
  }
}

export async function cargarProgramaINH(fecha) {
  const client = await mustPool().connect();
  try {
    const { rows } = await client.query(
      `SELECT datos FROM inh_programa WHERE fecha = $1`,
      [fecha]
    );
    return rows[0]?.datos || null;
  } finally {
    client.release();
  }
}

export async function initAllTables() {
  const client = await mustPool().connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS resultados (
        id SERIAL PRIMARY KEY,
        fuente VARCHAR(50) NOT NULL,
        fecha VARCHAR(10) NOT NULL,
        hora VARCHAR(10) NOT NULL,
        datos JSONB,
        estado VARCHAR(20) DEFAULT 'completed',
        actualizado TIMESTAMP DEFAULT NOW(),
        UNIQUE(fuente, fecha, hora)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS inh_programa (
        id SERIAL PRIMARY KEY,
        fecha VARCHAR(10) NOT NULL UNIQUE,
        datos JSONB,
        actualizado TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('[DB] Tablas creadas/verificadas');
  } finally {
    client.release();
  }
}
