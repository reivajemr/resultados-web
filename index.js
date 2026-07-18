import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import AnimalitosScheduler from './scheduler.js';
import * as dbModule from './db.js';
import { ensureChrome } from './install-chrome.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.PUPPETEER_CACHE_DIR = process.env.PUPPETEER_CACHE_DIR || path.join(__dirname, '.puppeteer-cache');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

const HTTP_USER = process.env.HTTP_USER;
const HTTP_PASS = process.env.HTTP_PASS;
const API_KEY = process.env.API_KEY;

const db = process.env.DATABASE_URL ? dbModule : null;

const animalitos = new AnimalitosScheduler({
  loteriaEmail: process.env.LOTERIA_EMAIL,
  loteriaPassword: process.env.LOTERIA_PASSWORD,
  db
});

let inh = null;
let inhPollInterval = null;
let inhProgramCache = null;
let inhLastProgramFetch = null;
let inhReady = false;

/* ───── INH Scheduler ───── */

function parseTimeToDate(timeStr) {
  if (!timeStr) return null;
  const parts = timeStr.match(/(\d+):(\d+)\s*(AM|PM)?/i);
  if (!parts) return null;
  let h = parseInt(parts[1]);
  const m = parseInt(parts[2]);
  const ampm = parts[3]?.toUpperCase();
  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

function scheduleINHDay() {
  const now = new Date();
  const targetHour = 9;
  const targetMin = 0;

  const todayRun = new Date(now);
  todayRun.setHours(targetHour, targetMin, 0, 0);

  if (now > todayRun) {
    runINHDay().catch(e => console.error('[INH] Error en jornada:', e.message));
  }

  const tomorrow = new Date(now);
  tomorrow.setHours(targetHour, targetMin, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const delay = tomorrow.getTime() - now.getTime();
  console.log(`[INH] Próxima programación: ${tomorrow.toLocaleString()}`);

  setTimeout(async () => {
    await runINHDay();
    scheduleINHDay();
  }, delay);
}

async function runINHDay() {
  console.log('[INH] Iniciando jornada...');
  try {
    await inh.start();
    inhProgramCache = await inh.getDailyProgram();
    inhLastProgramFetch = new Date();

    console.log(`[INH] Programación: ${inhProgramCache.length} carreras encontradas`);

    if (inhProgramCache.length === 0) {
      console.log('[INH] No hay carreras hoy');
      await inh.stop();
      return;
    }

    const races = inhProgramCache.filter(r => r.raceTime);
    if (races.length === 0) {
      console.log('[INH] Carreras sin hora definida');
      await inh.stop();
      return;
    }

    const times = races
      .map(r => parseTimeToDate(r.raceTime))
      .filter(Boolean)
      .sort((a, b) => a - b);

    if (times.length === 0) {
      await inh.stop();
      return;
    }

    const firstRaceTime = times[0];
    const lastRaceTime = times[times.length - 1];

    const pollStart = new Date(firstRaceTime.getTime() - 60 * 60 * 1000);
    const pollEnd = new Date(lastRaceTime.getTime() + 30 * 60 * 1000);

    const delayToStart = Math.max(0, pollStart.getTime() - Date.now());

    console.log(`[INH] Polling desde ${pollStart.toLocaleTimeString()} hasta ${pollEnd.toLocaleTimeString()}`);

    setTimeout(async () => {
      console.log('[INH] Iniciando polling de carreras...');
      await inh.poll();
      inhProgramCache = inh.getCache();

      inhPollInterval = setInterval(async () => {
        if (Date.now() > pollEnd.getTime()) {
          console.log('[INH] Jornada finalizada');
          clearInterval(inhPollInterval);
          inhPollInterval = null;
          await inh.stop();
          inhProgramCache = null;
          return;
        }
        await inh.poll();
        inhProgramCache = inh.getCache();
      }, 10 * 60 * 1000);
    }, delayToStart);

  } catch (err) {
    console.error('[INH] Error en jornada:', err.message);
  }
}

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

app.get('/api/inh', (req, res) => {
  if (!inh) return res.json({ timestamp: new Date().toISOString(), program: [], races: [], isRunning: false, lastPoll: null, status: 'initializing' });
  const data = inhProgramCache || inh.getCache() || {};
  res.json({
    timestamp: new Date().toISOString(),
    program: Array.isArray(data?.program) ? data.program : [],
    races: Array.isArray(data?.races) ? data.races : [],
    isRunning: data?.isRunning || false,
    lastPoll: data?.lastPoll || null
  });
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
      running: inhProgramCache?.isRunning || false,
      lastPoll: inhProgramCache?.lastPoll || null,
      racesCount: inhProgramCache?.races?.length || 0
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
    inh: inhProgramCache ? {
      races: (Array.isArray(inhProgramCache) ? inhProgramCache : []).map(r => ({
        number: r.number || r.raceNumber,
        time: r.raceTime,
        horses: (r.horses || []).map(h => ({
          number: h.number, name: h.name, jockey: h.jockey
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
  } else {
    console.log('[DB] Sin DATABASE_URL — datos solo en memoria');
  }

  await animalitos.start();
  console.log('[Animalitos] Scheduler iniciado');

  animalitos.backfillRecentDays(2).catch(e =>
    console.error('[Backfill] Error:', e.message)
  );

  await ensureChrome();

  const { INHScraper } = await import('./inh-scraper.js');
  inh = new INHScraper({
    username: process.env.INH_USER,
    password: process.env.INH_PASS
  });
  inhReady = true;
  scheduleINHDay();
})().catch(e => {
  console.error('[Startup] Error:', e.message);
});

export default app;
