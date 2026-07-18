import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import axios from 'axios';

puppeteer.use(StealthPlugin());

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

    // Dismiss info modal that appears on every visit
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('button, a, span, div')) {
        const t = el.textContent?.trim().toUpperCase() || '';
        if ((t.includes('CONFIRMAR') || t.includes('CONTINUAR') || t.includes('ENTENDIDO')) && el.offsetParent !== null) {
          el.click();
          return;
        }
      }
    });
    await new Promise(r => setTimeout(r, 1500));

    // Click "Ingresar" to open login modal
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('a, button, span, div')) {
        if (el.textContent?.trim().toLowerCase() === 'ingresar' && el.offsetParent !== null) {
          el.click();
          return;
        }
      }
    });
    console.log('[INH] Click en Ingresar');
    await new Promise(r => setTimeout(r, 2000));

    if (DEBUG) await page.screenshot({ path: 'inh-login-modal.png', fullPage: true });

    // Type email and password using Puppeteer's native keyboard events
    // First find which input index is email vs password
    const inputInfo = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input');
      return Array.from(inputs).map((inp, i) => ({
        i,
        type: inp.type,
        placeholder: inp.placeholder,
        name: inp.name,
        id: inp.id,
        className: inp.className?.substring(0, 40)
      }));
    });
    console.log('[INH] Inputs:', JSON.stringify(inputInfo));

    // Type into fields using known names/selectors
    await page.type('input[name="email"]', INH_USER, { delay: 40 });
    await new Promise(r => setTimeout(r, 300));
    await page.type('input[name="password"]', INH_PASS, { delay: 40 });

    console.log('[INH] Formulario llenado con type()');

    await new Promise(r => setTimeout(r, 500));

    // Click "Iniciar Sesión"
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('button')) {
        const t = el.textContent?.trim().toLowerCase() || '';
        if (t.includes('iniciar sesión') || t.includes('iniciar sesion') || t === 'iniciar') {
          if (el.offsetParent !== null) { el.click(); return; }
        }
      }
    });
    console.log('[INH] Click en Iniciar Sesión');

    // Wait for login to process
    await new Promise(r => setTimeout(r, 5000));
    if (DEBUG) await page.screenshot({ path: 'inh-after-login.png', fullPage: true });

    // Check if login succeeded
    const bodyText = await page.evaluate(() => document.body.innerText);
    const isLoggedIn = !bodyText.includes('Ingresar') || bodyText.includes('Cerrar Sesión') || bodyText.includes('Mi Cuenta') || bodyText.includes('Saldo');
    console.log('[INH] ¿Login exitoso?', isLoggedIn, '| URL:', page.url());
    if (DEBUG) console.log('[INH] Text:', bodyText.substring(0, 1000).replace(/\n+/g, ' | '));

    // Dismiss any remaining modals
    let dismissed = true;
    while (dismissed) {
      dismissed = await page.evaluate(() => {
        for (const el of document.querySelectorAll('button, a, span, div')) {
          const t = el.textContent?.trim().toUpperCase() || '';
          if ((t.includes('CONFIRMAR') || t.includes('CONTINUAR') || t.includes('ENTENDIDO') || t === 'OK' || t === 'CERRAR' || t === 'CLOSE') && el.offsetParent !== null) {
            el.click();
            return true;
          }
        }
        return false;
      });
      if (dismissed) await new Promise(r => setTimeout(r, 1000));
    }
    console.log('[INH] Modales cerrados');

    await new Promise(r => setTimeout(r, 1000));

    // Dump page content
    let pageText = await page.evaluate(() => document.body.innerText.substring(0, 8000));
    console.log('[INH] Contenido:', pageText.replace(/\n+/g, ' | ').substring(0, 2000));

    // Try clicking Hipismo Nacional link
    console.log('[INH] Click en Hipismo Nacional...');
    await page.evaluate(() => {
      for (const link of document.querySelectorAll('a')) {
        if (link.textContent?.trim() === 'Hipismo Nacional' && link.offsetParent !== null) {
          link.click();
          return;
        }
      }
    });
    await new Promise(r => setTimeout(r, 5000));
    console.log('[INH] URL tras clic:', page.url());

    const cfBlocked = await page.evaluate(() => document.body.innerText.includes('security verification'));
    if (cfBlocked) {
      console.log('[INH] Cloudflare bloqueó la navegación');
    } else {
      pageText = await page.evaluate(() => document.body.innerText.substring(0, 8000));
      console.log('[INH] Contenido tras clic:', pageText.replace(/\n+/g, ' | ').substring(0, 2000));
    }
    if (DEBUG) await page.screenshot({ path: 'inh-hipismo-nacional.png', fullPage: true });
    if (cfBlocked && DEBUG) await page.screenshot({ path: 'inh-cf-blocked.png', fullPage: true });

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
