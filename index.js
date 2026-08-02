import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import AnimalitosScheduler from './scheduler.js';
import * as dbModule from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

const HTTP_USER = process.env.HTTP_USER;
const HTTP_PASS = process.env.HTTP_PASS;
const API_KEY = process.env.API_KEY;

const hasDb = !!(process.env.DATABASE_URL || process.env.PGHOST || process.env.PGPASSWORD || process.env.PGDATABASE);
const db = hasDb ? dbModule : null;

const VET_OFFSET = -4 * 3600000;
function vetToday() {
  return new Date(Date.now() + VET_OFFSET).toISOString().split('T')[0];
}

// "01:10 p. m." / "02:00 p. m." -> { h, min } en 24h, o null
function parseRaceTime(t) {
  if (!t) return null;
  const m = String(t).match(/(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const mer = m[3].toLowerCase();
  if (mer === 'p' && h !== 12) h += 12;
  if (mer === 'a' && h === 12) h = 0;
  return { h, min };
}

const animalitos = new AnimalitosScheduler({
  loteriaEmail: process.env.LOTERIA_EMAIL,
  loteriaPassword: process.env.LOTERIA_PASSWORD,
  db
});

let inhData = { program: [], races: [], lastPoll: null, isRunning: false };

/* ───── Security middleware ───── */

app.use(helmet());

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Demasiados requests, intenta en 15 min' }
});
app.use(globalLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,
  message: { error: 'Demasiados intentos de autenticación, intenta en 15 min' }
});
app.use(authLimiter);

function requireAuth(req, res, next) {
  if (req.path === '/health') return next();
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Basic ')) {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString();
    const [user, pass] = decoded.split(':');
    if (user === HTTP_USER && pass === HTTP_PASS) return next();
  }
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (key && key === API_KEY) return next();
  res.set('WWW-Authenticate', 'Basic realm="Resultados"');
  res.status(401).json({ error: 'No autorizado' });
}
app.use(requireAuth);

/* ───── API Routes ───── */

function normalizeRaces(races) {
  return (races || []).map(r => ({
    ...r,
    dividends: r.dividends || {},
    horses: (r.horses || []).map(h => ({
      ...h,
      isScratched: h.isScratched || false,
      position: h.position || null
    }))
  }));
}

app.get('/api/inh', async (req, res) => {
  const fecha = req.query.fecha;
  if (fecha) {
    if (!db) return res.status(503).json({ error: 'Base de datos no disponible' });
    try {
      const saved = await db.cargarProgramaINH(fecha);
      if (!saved) {
        return res.json({
          timestamp: new Date().toISOString(),
          program: [], races: [], isRunning: false, lastPoll: null, fecha
        });
      }
      return res.json({
        timestamp: new Date().toISOString(),
        program: Array.isArray(saved.program) ? saved.program : [],
        races: normalizeRaces(saved.races),
        isRunning: saved.isRunning || false,
        lastPoll: saved.lastPoll || null,
        fecha
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
  res.json({
    timestamp: new Date().toISOString(),
    program: Array.isArray(inhData?.program) ? inhData.program : [],
    races: Array.isArray(inhData?.races) ? inhData.races : [],
    isRunning: inhData?.isRunning || false,
    lastPoll: inhData?.lastPoll || null
  });
});

app.post('/api/inh/data', (req, res) => {
  if (req.headers['x-api-key'] !== process.env.API_KEY) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  const { program, races, isRunning, fecha } = req.body || {};
  const normRaces = normalizeRaces(races);
  // In-memory (live "today" view) only keeps today's races; past/future
  // jornadas are persisted to the DB under their own fecha.
  const today = vetToday();
  const todayRaces = normRaces.filter(r => (r.fecha || fecha || today) === today);
  inhData = {
    program: todayRaces.map(r => ({
      raceNumber: r.raceNumber,
      track: r.track,
      raceTime: r.raceTime || '',
      raceDate: r.raceDate || '',
      statusText: r.statusText || 'ABIERTA'
    })),
    races: todayRaces,
    isRunning: typeof isRunning === 'boolean' ? isRunning : inhData.isRunning,
    lastPoll: new Date().toISOString()
  };
  console.log('[INH] Datos recibidos:', inhData.program.length, 'carreras de hoy,', normRaces.length, 'totales');

  // Persist to DB, one row per canonical race date
  if (db && normRaces.length) {
    const toProgram = (rs) => rs.map(r => ({
      raceNumber: r.raceNumber,
      track: r.track,
      raceTime: r.raceTime || '',
      raceDate: r.raceDate || '',
      statusText: r.statusText || 'ABIERTA'
    }));
    const byFecha = {};
    for (const r of normRaces) {
      const d = r.fecha || fecha || vetToday();
      if (!byFecha[d]) byFecha[d] = [];
      byFecha[d].push(r);
    }
    const lastPoll = new Date().toISOString();
    for (const [d, rs] of Object.entries(byFecha)) {
      db.guardarProgramaINH(d, { program: toProgram(rs), races: rs, isRunning, lastPoll }).catch(e =>
        console.error(`[INH] Error guardando en DB (${d}):`, e.message)
      );
    }
  }

  res.json({ ok: true });
});

app.get('/api/inh/jornada', async (req, res) => {
  const today = vetToday();
  const tracks = [];
  let hasPrograma = false;
  let racesCount = 0;
  if (db) {
    try {
      const saved = await db.cargarProgramaINH(today);
      if (saved && Array.isArray(saved.races) && saved.races.length) {
        hasPrograma = true;
        racesCount = saved.races.length;
        for (const r of saved.races) {
          const t = r.track || r.hippodromo;
          if (t && !tracks.includes(t)) tracks.push(t);
        }
      }
    } catch (err) {
      console.error('[INH] Error leyendo jornada de hoy:', err.message);
    }
  }
  if (!hasPrograma && Array.isArray(inhData?.races) && inhData.races.length) {
    hasPrograma = true;
    racesCount = inhData.races.length;
    for (const r of inhData.races) {
      if (r.track && !tracks.includes(r.track)) tracks.push(r.track);
    }
  }
  res.json({ fecha: today, tracks, hasPrograma, racesCount });
});

// Responde si el scraper debe correr: "¿hay una carrera cerrada esperando resultados?"
app.get('/api/inh/needs-fetch', async (req, res) => {
  const today = vetToday();
  let saved = null;
  if (db) {
    try {
      saved = await db.cargarProgramaINH(today);
    } catch (err) {
      console.error('[INH] Error en needs-fetch (DB):', err.message);
    }
  }
  let races = saved && Array.isArray(saved.races) ? saved.races : [];
  let lastPollMs = saved && saved.lastPoll ? new Date(saved.lastPoll).getTime() : 0;
  if (!races.length && Array.isArray(inhData?.races) && inhData.races.length) {
    races = inhData.races;
    if (inhData.lastPoll) lastPollMs = new Date(inhData.lastPoll).getTime();
  }

  if (!races.length) {
    return res.json({ fetch: true, reason: 'sin programa guardado' });
  }

  const nowVET = new Date(Date.now() + VET_OFFSET);
  const nowMin = nowVET.getUTCHours() * 60 + nowVET.getUTCMinutes();
  const cooldownMs = 10 * 60 * 1000;

  for (const r of races) {
    const isClosed = String(r.statusText || '').toUpperCase() === 'CERRADA';
    const hasResult = Array.isArray(r.horses) && r.horses.some(h => h && h.position);
    if (isClosed && !hasResult) {
      if (lastPollMs && Date.now() - lastPollMs < cooldownMs) {
        return res.json({ fetch: false, reason: 'resultado pendiente, en cooldown' });
      }
      return res.json({ fetch: true, reason: `C${r.raceNumber}: cerrada sin resultados` });
    }
    if (!isClosed) {
      const t = parseRaceTime(r.raceTime);
      if (t && t.h * 60 + t.min <= nowMin) {
        return res.json({ fetch: true, reason: `C${r.raceNumber}: vencida sin cerrar` });
      }
    }
  }
  return res.json({ fetch: false, reason: 'nada pendiente' });
});

app.post('/api/inh/clear', async (req, res) => {
  if (req.headers['x-api-key'] !== process.env.API_KEY) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  if (!db) return res.status(503).json({ error: 'Base de datos no disponible' });
  try {
    const deleted = await db.vaciarProgramaINH();
    res.json({ ok: true, deleted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/animalitos', (req, res) => {
  res.json({
    timestamp: new Date().toISOString(),
    games: animalitos.getResults()
  });
});

app.get('/api/animalitos/historial', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Base de datos no disponible' });
  const fecha = req.query.fecha || animalitos._getTodayStr();
  const gameId = req.query.juego;
  const GAMES_LIST = (await import('./scheduler.js')).GAMES;
  try {
    if (gameId) {
      const game = GAMES_LIST.find(g => g.id === gameId);
      const rows = await db.cargarResultados(gameId, fecha);
      const draws = rows ? rows.map(r => ({
        time: r.hora,
        result: r.datos,
        status: r.estado,
        attempts: 1,
        error: null
      })) : [];
      return res.json({ timestamp: new Date().toISOString(), games: [{
        id: gameId, name: game?.name || gameId,
        draws
      }]});
    }
    const result = [];
    for (const g of GAMES_LIST) {
      const rows = await db.cargarResultados(g.id, fecha);
      const draws = rows ? rows.map(r => ({
        time: r.hora,
        result: r.datos,
        status: r.estado,
        attempts: 1,
        error: null
      })) : [];
      result.push({ id: g.id, name: g.name, draws });
    }
    res.json({ timestamp: new Date().toISOString(), games: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/animalitos/migrate', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Base de datos no disponible' });
  try {
    await animalitos._saveMemoryCacheToDB();
    res.json({ success: true, message: 'Caché en memoria migrada a DB' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/animalitos/refetch', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Base de datos no disponible' });
  const fecha = req.query.fecha;
  if (!fecha) return res.status(400).json({ error: 'Se requiere ?fecha=YYYY-MM-DD' });
  try {
    const saved = await animalitos.refetchDate(fecha);
    res.json({ success: true, fecha, saved: saved.length, results: saved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/debug/lotto-page', async (req, res) => {
  const axios = (await import('axios')).default;
  const cheerio = await import('cheerio');
  const juego = req.query.juego || 'lotto_activo';
  try {
    const resp = await axios.get(`https://www.lottoactivo.com/resultados/${juego}/`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 15000
    });
    const $ = cheerio.load(resp.data);
    const scripts = $('script').map((_, el) => $(el).html()).get();
    const allMatches = [];
    for (const s of scripts) {
      if (!s) continue;
      const matches = s.match(/'option':'([^']+)'/g);
      if (matches) allMatches.push(...matches);
    }
    const sampleScripts = scripts.filter(s => s && s.includes('option')).slice(0, 3);
    res.json({
      juego,
      status: resp.status,
      contentLength: resp.data.length,
      scriptCount: scripts.length,
      scriptsWithOption: scripts.filter(s => s && s.includes('option')).length,
      matches: allMatches.slice(0, 10),
      hasSessionCookie: !!resp.headers['set-cookie'],
      sampleScripts: sampleScripts.map(s => s.substring(0, 300))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/debug/lotto', async (req, res) => {
  const { debugLottoActivo } = await import('./proxies.js');
  const juego = req.query.juego || 'lotto_activo';
  const fecha = req.query.fecha || new Date(Date.now() - 4 * 3600000).toISOString().split('T')[0];
  try {
    const data = await debugLottoActivo(juego, fecha);
    res.json({ juego, fecha, debug: data });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

app.get('/api/status', (req, res) => {
  res.json({
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    inh: {
      running: inhData?.isRunning || false,
      lastPoll: inhData?.lastPoll || null,
      racesCount: inhData?.races?.length || 0
    },
    animalitos: {
      gamesCount: animalitos.getResults().length
    }
  });
});

/* ───── External API (limpo) ───── */

app.get('/api/v1/resultados', async (req, res) => {
  const fecha = req.query.fecha || animalitos._getTodayStr();
  const GAMES_LIST = (await import('./scheduler.js')).GAMES;
  let games;
  if (fecha === animalitos._getTodayStr()) {
    games = animalitos.getResults();
  } else if (db) {
    games = [];
    for (const g of GAMES_LIST) {
      const rows = await db.cargarResultados(g.id, fecha);
      games.push({ id: g.id, name: g.name, draws: (rows || []).map(r => ({
        time: r.hora, result: r.datos, status: r.estado
      })) });
    }
  } else {
    return res.status(503).json({ error: 'DB no disponible para fechas históricas' });
  }
  res.json({
    date: fecha,
    animalitos: games.map(g => ({
      game: g.name,
      draws: g.draws.filter(d => d.result).map(d => ({
        time: d.time,
        number: d.result.number,
        animal: d.result.animal,
        color: d.result.color || undefined
      }))
    })),
    inh: inhData?.races?.length ? {
      races: inhData.races.map(r => ({
        number: r.raceNumber,
        time: r.raceTime,
        track: r.track,
        status: r.statusText,
        date: r.raceDate || undefined,
        exotics: r.dividends && Object.keys(r.dividends).length ? r.dividends : undefined,
        horses: (r.horses || []).map(h => ({
          number: h.programNumber || h.number,
          name: h.horseName || h.name,
          jockey: h.jockey,
          trainer: h.trainer || undefined,
          weight: h.weight || undefined,
          dividend: h.dividend || undefined,
          position: h.position || undefined,
          ganadorDividend: h.ganadorDividend || undefined,
          placeDividend: h.placeDividend || undefined,
          scratched: h.isScratched || undefined
        }))
      }))
    } : null
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

/* ───── Static files ───── */

const staticDir = path.join(__dirname, 'client', 'dist');
app.use(express.static(staticDir));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(staticDir, 'index.html'));
});

/* ───── Start ───── */

app.listen(PORT, () => {
  console.log(`Servidor en http://localhost:${PORT}`);
});

/* ───── Background init ───── */

(async () => {
  if (db) {
    await db.initAllTables();
    console.log('[DB] Persistencia activa');

    // Load INH data from DB for today
    const saved = await db.cargarProgramaINH(vetToday());
    if (saved) {
      inhData = {
        program: Array.isArray(saved.program) ? saved.program : [],
        races: normalizeRaces(saved.races),
        isRunning: saved.isRunning || false,
        lastPoll: saved.lastPoll || null
      };
      console.log('[INH] Cargado desde DB:', inhData.program.length, 'carreras');
    } else {
      console.log('[INH] Sin datos guardados para hoy');
    }
  } else {
    console.log('[DB] Sin DATABASE_URL — datos solo en memoria');
  }

  await animalitos.start();
  console.log('[Animalitos] Scheduler iniciado');

  animalitos.backfillRecentDays(2).catch(e =>
    console.error('[Backfill] Error:', e.message)
  );

  console.log('[INH] Esperando datos desde GitHub Actions...');
})().catch(e => {
  console.error('[Startup] Error:', e.message);
});

export default app;
