import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { INHScraper } from './inh-scraper.js';
import AnimalitosScheduler from './scheduler.js';
import * as dbModule from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const db = process.env.DATABASE_URL ? dbModule : null;
if (db) {
  await db.initAllTables();
  console.log('[DB] Persistencia activa');
} else {
  console.log('[DB] Sin DATABASE_URL — datos solo en memoria');
}

const inh = new INHScraper({
  username: process.env.INH_USER,
  password: process.env.INH_PASS
});

const animalitos = new AnimalitosScheduler({
  loteriaEmail: process.env.LOTERIA_EMAIL,
  loteriaPassword: process.env.LOTERIA_PASSWORD,
  db
});

let inhPollInterval = null;
let inhProgramCache = null;
let inhLastProgramFetch = null;

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

  const firstRun = new Date(now);
  firstRun.setHours(targetHour, targetMin, 0, 0);

  if (now > firstRun) {
    firstRun.setDate(firstRun.getDate() + 1);
  }

  const delay = firstRun.getTime() - now.getTime();
  console.log(`[INH] Próxima programación: ${firstRun.toLocaleString()}`);

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

/* ───── Animalitos Scheduler ───── */

await animalitos.start();
console.log('[Animalitos] Scheduler iniciado');

/* ───── INH schedule ───── */

scheduleINHDay();

/* ───── API Routes ───── */

app.get('/api/inh', (req, res) => {
  const data = inhProgramCache || inh.getCache();
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

export default app;
