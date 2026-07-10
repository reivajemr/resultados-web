import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

export async function initDB() {
  const client = await pool.connect();
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
  const client = await pool.connect();
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
  const client = await pool.connect();
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
  const client = await pool.connect();
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
  const client = await pool.connect();
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
  const client = await pool.connect();
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
