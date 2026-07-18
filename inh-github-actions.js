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

    // ── Explore navigation ──

    // Print all links on the page
    const links = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a')).map(a => ({ href: a.href, text: a.textContent?.trim().substring(0, 60) }));
    });
    console.log('[INH] Links disponibles:', JSON.stringify(links.slice(0, 30)));

    // Print menus
    const menuText = await page.evaluate(() => {
      const nav = document.querySelector('nav, header, [class*="menu"], [class*="navbar"], [class*="header"]');
      return nav ? nav.innerText.substring(0, 1000) : 'no nav found';
    });
    console.log('[INH] Menú:', menuText.substring(0, 500));

    // ── Navigate to hipismo nacional page ──
    // Try common race page URLs
    const urlsToTry = [
      'https://apuestas.inh.gob.ve/hipismo/nacional',
      'https://apuestas.inh.gob.ve/apuestas/nacional',
      'https://apuestas.inh.gob.ve/hipismo',
      'https://apuestas.inh.gob.ve/hipismo/valencia',
      'https://apuestas.inh.gob.ve/hipismo/rinconada',
      'https://apuestas.inh.gob.ve/hipismo/5y6',
    ];

    let racePageText = '';
    let racePageUrl = '';
    for (const url of urlsToTry) {
      console.log('[INH] Probando:', url);
      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
        await new Promise(r => setTimeout(r, 2000));
        const textLen = (await page.evaluate(() => document.body.innerText.length)) || 0;
        console.log('[INH]  -> longitud texto:', textLen);
        if (textLen > 200) {
          racePageText = await page.evaluate(() => document.body.innerText.substring(0, 5000));
          racePageUrl = page.url();
          console.log('[INH] Contenido:', racePageText.replace(/\n+/g, ' | ').substring(0, 1000));
          if (DEBUG) await page.screenshot({ path: 'inh-' + url.replace(/[^a-z]/g, '') + '.png', fullPage: true });
          if (textLen > 500) break; // found a good page
        }
      } catch (e) {
        console.log('[INH]  -> error:', e.message.substring(0, 100));
      }
    }

    if (!racePageText) {
      // fallback: dump current page
      racePageText = await page.evaluate(() => document.body.innerText.substring(0, 5000));
      racePageUrl = page.url();
    }

    console.log('[INH] Usando URL:', racePageUrl);

    // ── Parse race data ──

    // Try to extract structured data
    const extracted = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tr, [class*="row"], [class*="card"], [class*="item"], li'));
      const items = [];
      rows.forEach(row => {
        const cells = row.querySelectorAll('td, th, [class*="cell"]');
        if (cells.length >= 2) {
          const data = Array.from(cells).map(c => c.textContent?.trim() || '');
          items.push(data);
        }
      });
      return items;
    });

    console.log(`[INH] Filas con datos: ${extracted.length}`);

    // Build structured payload with whatever we found
    const raceLines = racePageText.split('\n').map(l => l.trim()).filter(Boolean);

    // Try to parse structured races from the text
    const races = [];
    const program = [];

    // Simple heuristic: look for lines containing "CARRERA", "RACE", track names
    raceLines.forEach((line, i) => {
      const upper = line.toUpperCase();
      if (upper.includes('CARRERA') || upper.includes('CABALLO') || upper.includes('HIPICO')) {
        const num = line.match(/\d+/)?.[0];
        if (num) program.push({ number: num, title: line });
      }
    });

    const payload = {
      program: program.length > 0 ? program : raceLines.filter(l => /\d/.test(l)).slice(0, 50).map(l => ({ text: l.substring(0, 200) })),
      races: extracted.slice(0, 30).map(r => ({ cells: r })),
      isRunning: true,
      _debug: { url: racePageUrl, lines: raceLines.length, extractedLen: extracted.length }
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
