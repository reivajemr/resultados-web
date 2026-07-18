import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import axios from 'axios';

puppeteer.use(StealthPlugin());

const RENDER_URL = process.env.RENDER_URL || 'https://resultados-web.onrender.com';
const API_KEY = process.env.RENDER_API_KEY;
const INH_USER = process.env.INH_USER;
const INH_PASS = process.env.INH_PASS;

async function run() {
  if (!INH_USER || !INH_PASS) throw new Error('Faltan INH_USER o INH_PASS en secrets');

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu',
      '--single-process', '--no-zygote', '--disable-blink-features=AutomationControlled'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    );

    // ── 1. Login ──
    await page.goto('https://apuestas.inh.gob.ve', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 3000));

    await page.evaluate(() => {
      const walk = (el) => {
        if (el.nodeType === 1 && el.textContent?.trim().toLowerCase() === 'ingresar' && el.offsetParent !== null) {
          el.click(); return true;
        }
        for (const child of el.children) if (walk(child)) return true;
        return false;
      };
      walk(document.body);
    });
    await new Promise(r => setTimeout(r, 2500));

    await page.type('input[name="email"]', INH_USER, { delay: 25 + Math.random() * 20 });
    await page.type('input[name="password"]', INH_PASS, { delay: 25 + Math.random() * 20 });
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 6000));

    const isLoggedIn = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('Cerrar Sesión') || text.includes('Mi Cuenta') || text.includes('Saldo') || !text.includes('Ingresar');
    });
    console.log('[INH] Login OK:', isLoggedIn);
    if (!isLoggedIn) throw new Error('Login failed');

    // ── 2. Navigate to Hipismo Nacional ──
    console.log('[INH] Navigating to Hipismo Nacional...');
    const clicked = await page.evaluate(() => {
      for (const el of document.querySelectorAll('a, button')) {
        const t = el.textContent?.trim().toLowerCase() || '';
        if (t === 'hipismo nacional' || el.href?.includes('/apuestas/nacional')) {
          el.click(); return true;
        }
      }
      return false;
    });
    if (!clicked) throw new Error('No se encontró enlace');

    await new Promise(r => setTimeout(r, 10000));
    const isBlocked = await page.evaluate(() => document.body.innerText.toLowerCase().includes('security verification'));
    if (isBlocked) throw new Error('Cloudflare bloqueó');

    // ── 3. Extract race numbers from tab buttons ──
    const raceNumbers = await page.evaluate(() => {
      const nums = [];
      for (const btn of document.querySelectorAll('button')) {
        const m = btn.textContent?.trim().match(/^C(\d+)$/);
        if (m) nums.push(parseInt(m[1]));
      }
      return nums.sort((a, b) => a - b);
    });
    console.log('[INH] Race tabs:', raceNumbers.join(', '));

    // ── 4. Detect track ──
    const track = await page.evaluate(() => {
      const t = document.body.innerText;
      if (t.includes('VALENCIA')) return 'Valencia';
      if (t.includes('SANTA RITA')) return 'Santa Rita';
      return 'La Rinconada';
    });

    // ── 5. Extract horses for each race ──
    const races = [];
    for (const raceNum of raceNumbers) {
      // Click the tab for this race
      await page.evaluate((num) => {
        for (const btn of document.querySelectorAll('button')) {
          if (btn.textContent?.trim() === `C${num}`) {
            btn.click(); return;
          }
        }
      }, raceNum);
      await new Promise(r => setTimeout(r, 1500));

      // Extract horses from the now-visible tab
      const horses = await page.evaluate(() => {
        const result = [];
        for (const row of document.querySelectorAll('[class*="races-tab-grid"]')) {
          const spans = row.querySelectorAll('span');
          const firstSpan = spans[0]?.textContent?.trim() || '';
          if (!/^\d+$/.test(firstSpan)) continue; // skip header row

          const nameEl = row.querySelector('div[class*="text-sm"]');
          const detailEl = row.querySelector('span[class*="text-xs"]');
          const dividendEl = row.querySelector('span[class*="text-yellow"]');

          const horseName = nameEl?.textContent?.trim() || '';
          const detail = detailEl?.textContent?.trim() || '';
          const dividend = dividendEl?.textContent?.trim() || '';

          const jockey = detail.match(/Jockey:\s*([^/]+)/)?.[1]?.trim() || '';
          const trainer = detail.match(/Train:\s*([^)]+)/)?.[1]?.trim() || '';

          // Weight is the 2nd-to-last visible span before hidden ones
          let weight = '';
          if (spans.length >= 4) {
            weight = spans[Math.min(3, spans.length - 2)]?.textContent?.trim() || '';
          }

          result.push({
            programNumber: firstSpan,
            horseName,
            dividend,
            jockey,
            trainer,
            weight
          });
        }
        return result;
      });

      races.push({ raceNumber: raceNum, horses, track });
      console.log(`[INH] Race ${raceNum}: ${horses.length} horses`);
    }

    // ── 6. Build & send payload ──
    const program = races.map(r => ({
      raceNumber: r.raceNumber,
      track: r.track,
      raceTime: '',
      statusText: 'Programada'
    }));

    const payload = { program, races, isRunning: true };
    const totalHorses = races.reduce((s, r) => s + r.horses.length, 0);
    console.log(`[INH] Sending ${races.length} races, ${totalHorses} horses`);

    if (!API_KEY) throw new Error('Falta RENDER_API_KEY');
    await axios.post(`${RENDER_URL}/api/inh/data`, payload, {
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY }
    });
    console.log('[INH] Data sent OK');

  } finally {
    await browser.close();
  }
}

run().catch(e => {
  console.error('[INH] Error:', e.message);
  process.exit(1);
});
