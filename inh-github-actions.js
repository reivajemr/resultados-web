import puppeteer from 'puppeteer';
import axios from 'axios';

const RENDER_URL = process.env.RENDER_URL || 'https://resultados-web.onrender.com';
const API_KEY = process.env.RENDER_API_KEY;
const INH_USER = process.env.INH_USER;
const INH_PASS = process.env.INH_PASS;
const DEBUG = process.env.DEBUG_INH === '1';

async function run() {
  if (!INH_USER || !INH_PASS) throw new Error('Faltan INH_USER o INH_PASS en secrets');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--single-process', '--no-zygote']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36');

    // ── Login ──

    await page.goto('https://apuestas.inh.gob.ve', { waitUntil: 'networkidle2', timeout: 60000 });
    console.log('[INH] Página cargada');

    const loginClicked = await page.evaluate(() => {
      const all = document.querySelectorAll('button, a, [role="button"], span, div');
      for (const el of all) {
        const t = el.textContent?.trim().toLowerCase() || '';
        if (t === 'ingresar' || t === 'iniciar sesión' || t === 'iniciar sesion') {
          if (el.offsetParent !== null) { el.click(); return true; }
        }
      }
      const byAttr = document.querySelectorAll('a[href*="login"], a[href*="ingresar"], a[href*="iniciar"], a[href*="sesion"]');
      for (const el of byAttr) { if (el.offsetParent !== null) { el.click(); return true; } }
      return false;
    });
    if (!loginClicked) throw new Error('No se encontró botón de inicio de sesión');

    await page.waitForSelector('input, form', { timeout: 15000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));

    await page.evaluate((user, pass) => {
      let uf = document.querySelector('input[name="username"], input[name="user"], input[name="email"], input[type="email"], input[placeholder*="usuario"]');
      if (!uf) {
        const inputs = document.querySelectorAll('input:not([type="hidden"])');
        for (const inp of inputs) {
          if (inp.type === 'text' || inp.type === 'email') { uf = inp; break; }
        }
      }
      if (uf) { uf.value = user; uf.dispatchEvent(new Event('input', { bubbles: true })); }

      let pf = document.querySelector('input[type="password"]');
      if (!pf) {
        for (const name of ['password', 'pass', 'clave', 'contrasena', 'contraseña']) {
          pf = document.querySelector(`input[name="${name}"], input[id*="${name}"]`);
          if (pf) break;
        }
      }
      if (pf) { pf.value = pass; pf.dispatchEvent(new Event('input', { bubbles: true })); }
    }, INH_USER, INH_PASS);

    await new Promise(r => setTimeout(r, 500));

    const submitted = await page.evaluate(() => {
      const btns = document.querySelectorAll('button[type="submit"], input[type="submit"]');
      for (const b of btns) { if (b.offsetParent !== null) { b.click(); return true; } }
      const all = document.querySelectorAll('button');
      for (const b of all) {
        const t = b.textContent?.trim().toLowerCase() || '';
        if (t.includes('ingresar') || t.includes('entrar') || t.includes('iniciar')) {
          if (b.offsetParent !== null) { b.click(); return true; }
        }
      }
      return false;
    });
    if (!submitted) throw new Error('No se encontró botón de submit');

    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));

    console.log('[INH] Post-login URL:', page.url());
    console.log('[INH] Post-login title:', await page.title());
    if (DEBUG) await page.screenshot({ path: 'inh-after-login.png', fullPage: true });

    // Dump page content after login
    let pageText = await page.evaluate(() => document.body.innerText.substring(0, 8000));
    console.log('[INH] Contenido post-login:', pageText.replace(/\n+/g, ' | ').substring(0, 2000));

    // Click "Hipismo Nacional" link instead of navigating directly (evita Cloudflare)
    console.log('[INH] Haciendo clic en Hipismo Nacional...');
    const clicked = await page.evaluate(() => {
      const links = document.querySelectorAll('a');
      for (const link of links) {
        if (link.textContent?.trim() === 'Hipismo Nacional') {
          link.click();
          return true;
        }
      }
      return false;
    });

    if (!clicked) {
      console.log('[INH] No se encontró link Hipismo Nacional, usando contenido actual');
    } else {
      await new Promise(r => setTimeout(r, 5000));
      console.log('[INH] URL tras clic:', page.url());
      pageText = await page.evaluate(() => document.body.innerText.substring(0, 8000));
      console.log('[INH] Contenido tras clic:', pageText.replace(/\n+/g, ' | ').substring(0, 2000));
      if (DEBUG) await page.screenshot({ path: 'inh-hipismo-nacional.png', fullPage: true });
    }

    // ── Parse race data ──

    const raceLines = pageText.split('\n').map(l => l.trim()).filter(Boolean);
    console.log(`[INH] ${raceLines.length} líneas de texto`);

    // Try to extract structured data from HTML tables/cards
    const extracted = await page.evaluate(() => {
      const tables = document.querySelectorAll('table');
      if (tables.length > 0) {
        return Array.from(tables).map((tbl, ti) => ({
          table: ti,
          rows: Array.from(tbl.querySelectorAll('tr')).map(tr =>
            Array.from(tr.querySelectorAll('td, th')).map(c => c.textContent?.trim() || '')
          )
        }));
      }
      // Try cards
      const cards = document.querySelectorAll('[class*="card"], [class*="Card"]');
      if (cards.length > 0) {
        return Array.from(cards).map(c => c.textContent?.trim().substring(0, 200));
      }
      return [];
    });

    console.log(`[INH] Tablas/cards encontradas: ${extracted.length}`);

    // Parse races: group lines by track
    const program = [];
    const races = [];
    let currentTrack = '';

    raceLines.forEach((line, i) => {
      const upper = line.toUpperCase();
      if (upper.includes('RINCONADA') || upper.includes('VALENCIA') || upper.includes('SANTA RITA') || upper.includes('LA RINCONADA')) {
        currentTrack = line;
      } else if (upper.includes('CARRERA') && /\d+/.test(line)) {
        const num = line.match(/\d+/)?.[0];
        program.push({ track: currentTrack, number: num, text: line.substring(0, 150) });
      } else if (upper.includes('RESULTADO') || upper.includes('RESULTADOS') || upper.includes('LLEGADA')) {
        const nextLines = raceLines.slice(i + 1, i + 20).filter(l => /\d+[-\s]/.test(l));
        if (nextLines.length > 0) {
          races.push({
            track: currentTrack,
            title: line,
            horses: nextLines.slice(0, 15).map(l => {
              const parts = l.split(/\s{2,}/);
              return { text: l.substring(0, 100) };
            })
          });
        }
      }
    });

    const payload = {
      program: program.length > 0 ? program : raceLines.filter(l => /\d/.test(l)).slice(0, 50).map(l => ({ text: l.substring(0, 200) })),
      races: races.length > 0 ? races : extracted,
      isRunning: true
    };

    console.log(`[INH] Enviando: ${payload.program.length} programa, ${payload.races.length} carreras`);

    if (!API_KEY) throw new Error('Falta RENDER_API_KEY en secrets');
    await axios.post(`${RENDER_URL}/api/inh/data`, payload, {
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY }
    });
    console.log('[INH] Datos enviados a Render');

  } finally {
    await browser.close();
  }
}

run().catch(e => {
  console.error('[INH] Error:', e.message);
  process.exit(1);
});
