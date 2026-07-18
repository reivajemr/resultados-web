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

    // Click "Ingresar" to open login modal
    const modalOpened = await page.evaluate(() => {
      const all = document.querySelectorAll('a, button, span, div');
      for (const el of all) {
        if (el.textContent?.trim().toLowerCase() === 'ingresar' && el.offsetParent !== null) {
          el.click();
          return true;
        }
      }
      return false;
    });
    if (!modalOpened) throw new Error('No se encontró botón Ingresar');
    console.log('[INH] Click en Ingresar');

    await new Promise(r => setTimeout(r, 2000));

    // Fill login form (modal) — fields: "Correo Electrónico" and "Contraseña"
    const formFilled = await page.evaluate((user, pass) => {
      // Find email field
      const inputs = document.querySelectorAll('input');
      let emailField = null;
      let passField = null;
      for (const inp of inputs) {
        const type = inp.type || '';
        const ph = (inp.placeholder || '').toLowerCase();
        const name = (inp.name || '').toLowerCase();
        const id = (inp.id || '').toLowerCase();
        if (!emailField && (type === 'email' || type === 'text' || ph.includes('correo') || ph.includes('email') || ph.includes('usuario') || name.includes('email') || name.includes('user') || name.includes('login'))) {
          emailField = inp;
        }
        if (!passField && type === 'password') {
          passField = inp;
        }
      }
      if (!emailField || !passField) return false;

      emailField.value = '';
      emailField.value = user;
      emailField.dispatchEvent(new Event('input', { bubbles: true }));
      emailField.dispatchEvent(new Event('change', { bubbles: true }));

      passField.value = '';
      passField.value = pass;
      passField.dispatchEvent(new Event('input', { bubbles: true }));
      passField.dispatchEvent(new Event('change', { bubbles: true }));

      return true;
    }, INH_USER, INH_PASS);

    if (!formFilled) throw new Error('No se encontraron campos de email/contraseña');
    console.log('[INH] Formulario llenado');

    await new Promise(r => setTimeout(r, 500));

    // Click "Iniciar Sesión" button
    const loginSubmitted = await page.evaluate(() => {
      const all = document.querySelectorAll('button, input[type="submit"]');
      for (const el of all) {
        const t = el.textContent?.trim().toLowerCase() || '';
        if (t.includes('iniciar sesión') || t.includes('iniciar sesion') || t === 'iniciar') {
          if (el.offsetParent !== null) { el.click(); return true; }
        }
      }
      // fallback: any submit button inside the modal
      const modal = document.querySelector('[class*="modal"], [class*="Modal"], [role="dialog"], [class*="overlay"]');
      if (modal) {
        const btns = modal.querySelectorAll('button');
        for (const b of btns) { if (b.offsetParent !== null) { b.click(); return true; } }
      }
      return false;
    });

    if (!loginSubmitted) throw new Error('No se encontró botón Iniciar Sesión');
    console.log('[INH] Click en Iniciar Sesión');

    // Wait for modal to close (login success)
    await new Promise(r => setTimeout(r, 5000));

    // Check if login succeeded: look for logged-in indicators
    const isLoggedIn = await page.evaluate(() => {
      const text = document.body.innerText;
      // After login, "Ingresar" and "Registro" should be gone
      return !text.includes('Ingresar') || text.includes('Cerrar Sesión') || text.includes('Mi Cuenta') || text.includes('Saldo');
    });

    console.log('[INH] ¿Login exitoso?', isLoggedIn);
    console.log('[INH] URL:', page.url());
    console.log('[INH] Title:', await page.title());
    if (DEBUG) await page.screenshot({ path: 'inh-after-login.png', fullPage: true });

    // Dismiss any confirmation modal about payment info
    const modalDismissed = await page.evaluate(() => {
      const all = document.querySelectorAll('button, a, span, div');
      // Try "TOCA AQUÍ PARA CONFIRMAR Y CONTINUAR"
      for (const el of all) {
        const t = el.textContent?.trim().toUpperCase() || '';
        if (t.includes('CONFIRMAR') || t.includes('CONTINUAR') || t.includes('ENTENDIDO') || t === 'OK') {
          if (el.offsetParent !== null) { el.click(); return true; }
        }
      }
      return false;
    });
    if (modalDismissed) {
      console.log('[INH] Modal de confirmación cerrado');
      await new Promise(r => setTimeout(r, 1500));
    }

    await new Promise(r => setTimeout(r, 1000));

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
      // Check if Cloudflare blocked us
      const cfBlocked = await page.evaluate(() => document.body.innerText.includes('security verification'));
      if (cfBlocked) {
        console.log('[INH] Cloudflare bloqueó la navegación');
      } else {
        pageText = await page.evaluate(() => document.body.innerText.substring(0, 8000));
        console.log('[INH] Contenido tras clic:', pageText.replace(/\n+/g, ' | ').substring(0, 2000));
      }
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
