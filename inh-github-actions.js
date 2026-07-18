import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import axios from 'axios';
import fs from 'fs';

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
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--single-process',
      '--no-zygote',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    );

    // ── 1. Load homepage ──
    await page.goto('https://apuestas.inh.gob.ve', { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('[INH] Homepage loaded');
    await new Promise(r => setTimeout(r, 3000));

    // ── 2. Login ──
    await page.evaluate(() => {
      const walk = (el) => {
        if (el.nodeType === 1 && el.textContent?.trim().toLowerCase() === 'ingresar' && el.offsetParent !== null) {
          el.click();
          return true;
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
    console.log('[INH] Login OK:', isLoggedIn, '| URL:', page.url());
    if (!isLoggedIn) throw new Error('Login failed');

    // ── 3. Get race data via XHR (same-origin, bypasses Cloudflare) ──
    console.log('[INH] Fetching /apuestas/nacional via XHR...');
    const html = await page.evaluate(async () => {
      const res = await fetch('https://apuestas.inh.gob.ve/apuestas/nacional', { credentials: 'include' });
      return await res.text();
    });
    console.log('[INH] XHR HTML length:', html.length, '| preview:', html.substring(0, 400).replace(/\n/g, ' '));
    fs.writeFileSync('/tmp/inh-response.html', html);
    console.log('[INH] Saved XHR HTML to /tmp/inh-response.html');

    // ── 4. Parse horse data from HTML ──
    const allHorseDivs = html.match(/<div class="races-tab-grid[^>]*>[\s\S]*?<\/div>\s*<\/div>/g) || [];

    const horses = [];
    for (const div of allHorseDivs) {
      const num = div.match(/<span[^>]*>\s*(\d+)\s*<\/span>/);
      if (!num) continue;
      const dividend = div.match(/<span[^>]*class="[^"]*text-yellow-500[^"]*"[^>]*>\s*([^<]+)\s*<\/span>/);
      const nameMatch = div.match(/<div[^>]*class="[^"]*text-sm[^"]*"[^>]*>\s*([^<]+)\s*<\/div>/);
      const detailMatch = div.match(/<span[^>]*class="[^"]*text-xs[^"]*"[^>]*>\s*([^<]+)\s*<\/span>/);
      const weightMatch = div.match(/<span[^>]*class="[^"]*hidden[^"]*lg:block[^"]*"[^>]*>\s*(\d+\.?\d*)\s*<\/span>/);
      if (nameMatch) {
        const detail = detailMatch ? detailMatch[1].trim() : '';
        const jockey = detail.match(/Jockey:\s*([^/]+)/)?.[1]?.trim() || '';
        const trainer = detail.match(/Train:\s*([^)]+)/)?.[1]?.trim() || '';
        horses.push({
          programNumber: num[1],
          horseName: nameMatch[1].trim(),
          dividend: dividend ? dividend[1].trim() : '',
          jockey,
          trainer,
          weight: weightMatch ? weightMatch[1] : ''
        });
      }
    }
    console.log(`[INH] Parsed ${horses.length} horses from XHR HTML`);

    // ── 5. Detect race numbers from tabs (C1, C2...) ──
    const raceMatches = html.match(/<button[^>]*>\s*C(\d+)\s*<\/button>/g);
    let raceNumbers = [];
    if (raceMatches) {
      raceNumbers = [...new Set(raceMatches.map(t => parseInt(t.match(/C(\d+)/)?.[1] || '0')))].sort((a, b) => a - b);
    }
    console.log('[INH] Race tabs found:', raceNumbers.length > 0 ? raceNumbers.join(', ') : 'none');

    // ── 6. Fallback: try click navigation if XHR returned no horses ──
    if (horses.length === 0) {
      console.log('[INH] No horses in XHR, trying click navigation...');
      await page.screenshot({ path: '/tmp/inh-before-click.png', fullPage: true });

      const clicked = await page.evaluate(() => {
        const links = document.querySelectorAll('a, button');
        for (const link of links) {
          const t = link.textContent?.trim().toLowerCase() || '';
          if (t === 'apostas' || t === 'apostar' || t === 'hipismo nacional' || link.href?.includes('/apuestas/nacional')) {
            link.click(); return true;
          }
        }
        return false;
      });

      if (clicked) {
        console.log('[INH] Clicked link, waiting 8s...');
        await new Promise(r => setTimeout(r, 8000));
        await page.screenshot({ path: '/tmp/inh-after-click.png', fullPage: true });

        const cfBlocked = await page.evaluate(() => document.body.innerText.includes('security verification'));
        if (cfBlocked) {
          console.log('[INH] Cloudflare blocked navigation after click');
        } else {
          const renderedHtml = await page.content();
          fs.writeFileSync('/tmp/inh-after-click.html', renderedHtml);
          const horseRows = await page.evaluate(() => {
            const rows = document.querySelectorAll('[class*="races-tab-grid"]');
            return Array.from(rows).map(row => {
              const cells = row.querySelectorAll('span, div');
              return Array.from(cells).map(c => c.textContent?.trim()).filter(Boolean);
            });
          });
          console.log('[INH] Horses from DOM:', JSON.stringify(horseRows.slice(0, 15)));
        }
      } else {
        console.log('[INH] No navigation link found on page');
      }
    }

    // ── 7. Build payload matching the frontend's expected schema ──
    // UI expects: program[].{raceNumber, track, raceTime, statusText}
    //             races[].raceNumber, races[].horses[].{programNumber, horseName, position, isScratched}
    //             races[].dividends  (object)
    const track = 'La Rinconada';
    const races = raceNumbers.length > 0
      ? raceNumbers.map(num => ({ raceNumber: num, horses, track }))
      : (horses.length > 0 ? [{ raceNumber: 1, horses, track }] : []);

    const program = races.map(r => ({
      raceNumber: r.raceNumber,
      track: r.track,
      raceTime: '',
      statusText: 'Programada'
    }));

    const payload = { program, races, isRunning: true };
    console.log(`[INH] Payload: ${program.length} program items, ${horses.length} horses`);

    if (!API_KEY) throw new Error('Falta RENDER_API_KEY');
    await axios.post(`${RENDER_URL}/api/inh/data`, payload, {
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY }
    });
    console.log('[INH] Data sent to Render OK');

  } finally {
    await browser.close();
  }
}

run().catch(e => {
  console.error('[INH] Error:', e.message);
  process.exit(1);
});
