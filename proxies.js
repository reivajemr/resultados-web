import axios from 'axios';
import * as cheerio from 'cheerio';

const LOTTO_ACTIVO_BASE = 'https://www.lottoactivo.com';
const LOTTO_ACTIVO_API = `${LOTTO_ACTIVO_BASE}/core/process.php`;
const GUACHARITO_API = 'https://api.lotterly.co/v1/results/el-guacharito-millonario/';
const LOTERIA_SECURE = 'https://secure.loteriadehoy.com';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const ACTIVO_GAMES = {
  'lotto_activo': 'lotto_activo',
  'lotto_activo_2': 'lottoactivo2(monjemillonario)',
  'trio_activo': 'trio_activo',
  'terminal_activo': 'terminal_activo'
};

/* ───── Lotto Activo (token-based) ───── */

async function obtenerTokens(juego) {
  const { data: html } = await axios.get(`${LOTTO_ACTIVO_BASE}/resultados/${juego}/`, {
    headers: { 'User-Agent': USER_AGENT }
  });
  const $ = cheerio.load(html);
  const scripts = $('script').map((_, el) => $(el).html()).get();
  const tokens = new Set();
  for (const s of scripts) {
    if (!s) continue;
    const matches = s.match(/'option':'([^']+)'/g);
    if (matches) matches.forEach(m => {
      const opt = m.match(/'option':'([^']+)'/)[1];
      tokens.add(opt);
    });
  }
  return [...tokens];
}

async function postOption(option, loteria, fecha = null) {
  const params = new URLSearchParams({ option, loteria });
  if (fecha) params.append('fecha', fecha);
  const { data } = await axios.post(LOTTO_ACTIVO_API, params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT
    },
    timeout: 15000
  });
  return data?.status && data?.datos?.length ? data.datos : null;
}

export async function fetchLottoActivo(gameId, date) {
  const path = ACTIVO_GAMES[gameId];
  if (!path) throw new Error(`Juego desconocido: ${gameId}`);

  const tokens = await obtenerTokens(path);
  const dataTokens = [];

  for (const opt of tokens) {
    const info = await postOption(opt, path);
    if (!info || !info[0]?.tipojuego) {
      dataTokens.push(opt);
    }
  }

  const results = [];
  for (const opt of dataTokens) {
    const data = await postOption(opt, path, date);
    if (data) {
      for (const item of data) {
        if (item.resultados) results.push(item);
      }
    }
  }

  return results;
}

/* ───── El Guacharito Millonario (public API) ───── */

export async function fetchGuacharito(date) {
  const { data } = await axios.get(GUACHARITO_API, {
    params: { exact_date: date },
    headers: { 'User-Agent': USER_AGENT },
    timeout: 15000
  });
  return data;
}

/* ───── LoteriaDeHoy (session-based) ───── */

const loteriaSession = {
  cookieJar: null,
  expiry: null
};

async function loteriaLogin(email, password) {
  const params = new URLSearchParams({ email, password });
  const { headers } = await axios.post(`${LOTERIA_SECURE}/secureuser/login`, params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT
    },
    timeout: 15000,
    maxRedirects: 0,
    validateStatus: status => status < 400
  });

  const setCookie = headers['set-cookie'];
  if (setCookie) {
    loteriaSession.cookieJar = setCookie.join('; ');
    loteriaSession.expiry = Date.now() + 30 * 60 * 1000;
    return true;
  }
  return false;
}

async function ensureSession(email, password) {
  if (loteriaSession.cookieJar && Date.now() < loteriaSession.expiry) return;
  const ok = await loteriaLogin(email, password);
  if (!ok) throw new Error('Error al iniciar sesión en LoteriaDeHoy');
}

export async function fetchLoteriaDeHoy(email, password, date, oid, pid) {
  await ensureSession(email, password);

  const { data } = await axios.get(
    `${LOTERIA_SECURE}/result/tbl/${date}/${oid}/${pid}`,
    {
      headers: {
        'User-Agent': USER_AGENT,
        'Cookie': loteriaSession.cookieJar
      },
      timeout: 15000
    }
  );
  return data;
}

/* ───── La Granjita (via LoteriaDeHoy: oid=8, pid=22) ───── */

export async function fetchLaGranjita(email, password, date) {
  return fetchLoteriaDeHoy(email, password, date, 8, 22);
}
