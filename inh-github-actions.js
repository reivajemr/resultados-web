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

    await page.goto('https://apuestas.inh.gob.ve', { waitUntil: 'networkidle2', timeout: 60000 });

    // Debug: dump page text
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 2000));
    console.log('[Debug] Page text:', bodyText.replace(/\n+/g, ' | '));
    if (DEBUG) await page.screenshot({ path: 'inh-page.png', fullPage: true });

    // Find login button - try XPath first, then CSS
    const loginClicked = await page.evaluate(() => {
      // Try XPath-like text search
      const allBtns = document.querySelectorAll('button, a, [role="button"], span, div');
      for (const el of allBtns) {
        const t = el.textContent?.trim().toLowerCase() || '';
        if (t === 'ingresar' || t === 'iniciar sesión' || t === 'iniciar sesion' || t.startsWith('ingresar') || t.startsWith('iniciar')) {
          if (el.offsetParent !== null) {
            console.log('[Debug] Clicking by text:', el.textContent?.trim().substring(0, 50));
            el.click();
            return true;
          }
        }
      }
      // Try href-based
      const byHref = document.querySelectorAll('a[href*="login"], a[href*="ingresar"], a[href*="iniciar"], a[href*="sesion"]');
      for (const el of byHref) {
        if (el.offsetParent !== null) { el.click(); return true; }
      }
      // Try class-based
      const byClass = document.querySelectorAll('[class*="login"], [class*="ingresar"], [class*="sesion"]');
      for (const el of byClass) {
        if (el.offsetParent !== null) { el.click(); return true; }
      }
      return false;
    });

    if (!loginClicked) {
      const html = await page.evaluate(() => document.body.innerHTML.substring(0, 3000));
      console.log('[Debug] HTML snippet:', html);
      throw new Error('No se encontró botón de inicio de sesión');
    }

    // Wait for login form
    await page.waitForSelector('form, input, button[type="submit"]', { timeout: 15000 }).catch(() => {
      // if no form found, continue anyway
    });

    // Wait a moment for any animations
    await new Promise(r => setTimeout(r, 1000));

    // Fill login form - try multiple possible field names
    await page.evaluate((user, pass) => {
      const fields = ['username', 'user', 'email', 'login', 'usuario', 'correo'];
      const passFields = ['password', 'pass', 'clave', 'contrasena', 'contraseña'];
      let userField = null;
      for (const name of fields) {
        const el = document.querySelector(`input[name="${name}"], input[id*="${name}"], input[placeholder*="${name}"]`);
        if (el) { userField = el; break; }
      }
      if (!userField) {
        // Try any visible text input before password field
        const inputs = document.querySelectorAll('input:not([type="hidden"])');
        for (const inp of inputs) {
          if (inp.type === 'text' || inp.type === 'email') { userField = inp; break; }
        }
      }
      if (userField) {
        userField.focus();
        userField.value = '';
        userField.value = user;
        userField.dispatchEvent(new Event('input', { bubbles: true }));
        userField.dispatchEvent(new Event('change', { bubbles: true }));
      }

      let passField = null;
      for (const name of passFields) {
        const el = document.querySelector(`input[name="${name}"], input[id*="${name}"], input[placeholder*="${name}"]`);
        if (el) { passField = el; break; }
      }
      if (!passField) passField = document.querySelector('input[type="password"]');
      if (passField) {
        passField.focus();
        passField.value = '';
        passField.value = pass;
        passField.dispatchEvent(new Event('input', { bubbles: true }));
        passField.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, INH_USER, INH_PASS);

    if (DEBUG) await page.screenshot({ path: 'inh-login-filled.png', fullPage: true });

    // Click submit button
    const submitted = await page.evaluate(() => {
      const submitTypes = document.querySelectorAll('button[type="submit"], input[type="submit"]');
      for (const btn of submitTypes) {
        if (btn.offsetParent !== null) { btn.click(); return true; }
      }
      // Try buttons containing login text
      const allBtns = document.querySelectorAll('button');
      for (const btn of allBtns) {
        const t = btn.textContent?.trim().toLowerCase() || '';
        if (t.includes('ingresar') || t.includes('entrar') || t.includes('acceder') || t.includes('iniciar')) {
          if (btn.offsetParent !== null) { btn.click(); return true; }
        }
      }
      // Try any visible button within the form
      const form = document.querySelector('form');
      if (form) {
        const btns = form.querySelectorAll('button');
        for (const btn of btns) { if (btn.offsetParent !== null) { btn.click(); return true; } }
      }
      return false;
    });

    if (!submitted) throw new Error('No se encontró botón de envío del formulario');

    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));

    if (DEBUG) await page.screenshot({ path: 'inh-after-login.png', fullPage: true });
    console.log('[INH] Login exitoso, URL:', page.url());

    // Navigate to races page
    await page.goto('https://apuestas.inh.gob.ve/apuestas/nacional', { waitUntil: 'networkidle2', timeout: 30000 });

    await new Promise(r => setTimeout(r, 2000));
    if (DEBUG) await page.screenshot({ path: 'inh-races.png', fullPage: true });

    // Extract race data using generic selectors
    const program = await page.evaluate(() => {
      const items = document.querySelectorAll('[class*="carrera"], [class*="race"], [class*="Carrera"], [class*="Race"], tr, [class*="card"]');
      const data = [];
      items.forEach(item => {
        const text = item.textContent?.trim() || '';
        if (!text) return;
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length < 2) return;
        const raceNumber = lines[0].match(/\d+/)?.[0];
        if (!raceNumber) return;
        data.push({ html: text.substring(0, 200) });
      });
      return data;
    });

    console.log(`[INH] Items encontrados: ${program.length}`);

    // Simple approach: send all visible text
    const pageText = await page.evaluate(() => document.body.innerText);
    const raceLines = pageText.split('\n').map(l => l.trim()).filter(Boolean);

    const payload = {
      program: raceLines.filter(l => /\d/.test(l)).map(l => ({ text: l })),
      races: [],
      isRunning: true
    };

    console.log(`[INH] ${payload.program.length} líneas extraídas`);

    if (!API_KEY) throw new Error('Falta RENDER_API_KEY en secrets');
    if (!RENDER_URL) throw new Error('Falta RENDER_URL en variables');
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
