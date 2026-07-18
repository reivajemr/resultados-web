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

    // ── 2. Navigate ──
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

    // ── 3. Detect track ──
    const track = await page.evaluate(() => {
      const t = document.body.innerText;
      if (t.includes('VALENCIA')) return 'Valencia';
      if (t.includes('SANTA RITA')) return 'Santa Rita';
      return 'La Rinconada';
    });
    console.log('[INH] Track:', track);

    // ── 4. Extract race numbers ──
    const raceNumbers = await page.evaluate(() => {
      const nums = [];
      for (const btn of document.querySelectorAll('button')) {
        const m = btn.textContent?.trim().match(/^C(\d+)$/);
        if (m) nums.push(parseInt(m[1]));
      }
      return nums.sort((a, b) => a - b);
    });
    console.log('[INH] Race tabs:', raceNumbers.join(', '));

    // ── 5. Extract horses for each race ──
    const races = [];
    for (const raceNum of raceNumbers) {
      await page.evaluate((num) => {
        for (const btn of document.querySelectorAll('button')) {
          if (btn.textContent?.trim() === `C${num}`) {
            btn.click(); return;
          }
        }
      }, raceNum);
      await new Promise(r => setTimeout(r, 1500));

      const horses = await page.evaluate(() => {
        const result = [];
        for (const row of document.querySelectorAll('[class*="races-tab-grid"]')) {
          // Collect all direct child elements (grid columns)
          const children = Array.from(row.children);
          const textValues = children.map(el => el.textContent?.trim() || '');

          // First direct child that's a number -> horse number (skip header rows)
          const numIdx = textValues.findIndex(t => /^\d+$/.test(t));
          if (numIdx === -1) continue;

          const programNumber = textValues[numIdx];

          // Find dividend: look for text-yellow in ANY descendant
          let dividend = '';
          for (const child of children) {
            const yellow = child.querySelector('[class*="text-yellow"]');
            if (yellow) { dividend = yellow.textContent?.trim() || ''; break; }
            if (child.className?.includes('text-yellow')) {
              dividend = child.textContent?.trim() || ''; break;
            }
          }

          // Find horse name + detail: look for a container div with text-sm inside
          let horseName = '', jockey = '', trainer = '';
          for (const child of children) {
            const nameEl = child.querySelector('[class*="text-sm"]');
            if (nameEl) {
              horseName = nameEl.textContent?.trim() || '';
              // Detail is a sibling of nameEl within the same parent
              const parent = nameEl.parentElement;
              if (parent) {
                for (const sibling of parent.children) {
                  if (sibling !== nameEl) {
                    const txt = sibling.textContent?.trim() || '';
                    if (txt.length > 2 && !/^\d+\.?\d*$/.test(txt)) {
                      const jMatch = txt.match(/Jockey:\s*([^/]+)/i);
                      if (jMatch) {
                        jockey = jMatch[1]?.trim() || '';
                        trainer = txt.match(/Train:\s*([^)]+)/i)?.[1]?.trim() || '';
                      } else if (txt.includes('·')) {
                        const parts = txt.split('·').map(s => s.trim());
                        if (parts.length >= 2) {
                          jockey = parts.slice(0, -1).join(' · ');
                          trainer = parts[parts.length - 1];
                        }
                      } else {
                        jockey = txt;
                      }
                      break;
                    }
                  }
                }
              }
              break;
            }
            // Also check if the child itself has text-sm
            if (child.className?.includes('text-sm')) {
              horseName = child.textContent?.trim() || '';
            }
          }

          // Weight: element with hidden class that's a direct grid child (not nested)
          let weight = '';
          for (const child of children) {
            const cls = child.className || '';
            if (cls.includes('hidden') && !child.textContent?.includes('Jockey') && !child.textContent?.includes('·')) {
              const wt = child.textContent?.trim() || '';
              if (/^[\d\.\-]+$/.test(wt) || wt === '-') {
                weight = wt; break;
              }
            }
          }

          result.push({ programNumber, horseName, dividend, jockey, trainer, weight });
        }
        return result;
      });

      // ── 5b. Extract results for this race ──
      const results = await page.evaluate(() => {
        // Look for a results section near the race grid
        // Usually has "Resultados C{N}" heading
        const resultRows = [];
        // Find all result rows (with positions like 1°, 2°, 3°, etc.)
        const allDivs = document.querySelectorAll('div.grid');
        for (const div of allDivs) {
          const text = div.textContent || '';
          if (/[1-5]°/.test(text) && (text.includes('Ganador') || text.includes('Place'))) {
            const cells = div.querySelectorAll('span, div');
            const texts = Array.from(cells).map(c => c.textContent?.trim() || '');
            const posMatch = texts.find(t => /^(\d+)°$/.test(t));
            const numMatch = texts.find(t => /^\d+$/.test(t));
            const nameMatch = texts.find(t => t.length > 2 && !/^\d+°$/.test(t) && !/^\d+$/.test(t) && t !== 'Ganador' && t !== 'Place' && t !== '-' && !t.includes('Bs'));
            const ganadorIdx = texts.findIndex(t => t === 'Ganador' || t === 'G');
            const placeIdx = texts.findIndex(t => t === 'Place' || t === 'P');
            const ganador = ganadorIdx >= 0 && ganadorIdx + 1 < texts.length ? texts[ganadorIdx + 1] : '';
            const place = placeIdx >= 0 && placeIdx + 1 < texts.length ? texts[placeIdx + 1] : '';

            if (posMatch && numMatch && nameMatch) {
              resultRows.push({
                position: parseInt(posMatch),
                programNumber: numMatch,
                horseName: nameMatch,
                ganador,
                place
              });
            }
          }
        }
        return resultRows;
      });

      races.push({
        raceNumber: raceNum,
        horses,
        track,
        results: results.length > 0 ? results : undefined
      });

      console.log(`[INH] Race ${raceNum}: ${horses.length} horses, ${results.length} results`);
    }

    // ── 6. Build payload ──
    const program = races.map(r => ({
      raceNumber: r.raceNumber,
      track: r.track,
      raceTime: '',
      statusText: r.results?.length ? 'CERRADA' : 'ABIERTA'
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
