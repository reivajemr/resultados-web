import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import axios from 'axios';

puppeteer.use(StealthPlugin());

const RENDER_URL = process.env.RENDER_URL || 'https://resultados-web.onrender.com';
const API_KEY = process.env.RENDER_API_KEY;
const INH_USER = process.env.INH_USER;
const INH_PASS = process.env.INH_PASS;

async function login(page) {
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
  if (!isLoggedIn) throw new Error('Login failed');
  console.log('[INH] Login OK');
}

async function navigateToRaces(page) {
  const clicked = await page.evaluate(() => {
    for (const el of document.querySelectorAll('a, button')) {
      const t = el.textContent?.trim().toLowerCase() || '';
      if (t === 'hipismo nacional' || el.href?.includes('/apuestas/nacional')) {
        el.click(); return true;
      }
    }
    return false;
  });
  if (!clicked) throw new Error('No se encontró enlace a Hipismo Nacional');
  await new Promise(r => setTimeout(r, 10000));

  const isBlocked = await page.evaluate(() => document.body.innerText.toLowerCase().includes('security verification'));
  if (isBlocked) throw new Error('Cloudflare bloqueó navegación');
}

async function switchTrack(page, trackName) {
  // Click the hipódromo select trigger
  const clicked = await page.evaluate((name) => {
    const triggers = document.querySelectorAll('[data-slot="select-trigger"], button[role="combobox"]');
    for (const btn of triggers) {
      if (btn.textContent?.trim().toLowerCase() === name.toLowerCase()) return false; // already on this track
      if (btn.textContent?.trim().toLowerCase().includes('hipódromo') || btn.getAttribute('aria-controls')) {
        btn.click(); return true;
      }
    }
    return false;
  }, trackName);

  if (!clicked) {
    if (trackName === 'La Rinconada') return false; // already on LR
    console.log(`[INH] Could not find track selector for ${trackName}`);
    return false;
  }

  await new Promise(r => setTimeout(r, 1500));

  // Find and click the option in the dropdown portal
  const selected = await page.evaluate((name) => {
    // Options are in a portal, might be in a different part of the DOM
    const options = document.querySelectorAll('[role="option"], [data-slot="select-item"]');
    for (const opt of options) {
      if (opt.textContent?.trim().toLowerCase() === name.toLowerCase()) {
        opt.click(); return true;
      }
    }
    // Try finding in scroll containers or portal roots
    const allElements = document.querySelectorAll('body > *:last-child, body > *:nth-last-child(2)');
    for (const container of allElements) {
      const items = container.querySelectorAll('[role="option"], [data-slot="select-item"], [class*="select-item"]');
      for (const item of items) {
        if (item.textContent?.trim().toLowerCase() === name.toLowerCase()) {
          item.click(); return true;
        }
      }
    }
    return false;
  }, trackName);

  if (!selected) {
    console.log(`[INH] Could not find option ${trackName} in dropdown`);
    return false;
  }

  // Wait for page to load new track data
  await new Promise(r => setTimeout(r, 5000));
  return true;
}

async function extractRaces(page) {
  // Detect track
  const track = await page.evaluate(() => {
    const t = document.body.innerText;
    if (t.includes('VALENCIA')) return 'Valencia';
    if (t.includes('SANTA RITA')) return 'Santa Rita';
    return 'La Rinconada';
  });

  // Get race numbers from tabs
  const raceNumbers = await page.evaluate(() => {
    const nums = [];
    for (const btn of document.querySelectorAll('button')) {
      const m = btn.textContent?.trim().match(/^C(\d+)$/);
      if (m) nums.push(parseInt(m[1]));
    }
    return nums.sort((a, b) => a - b);
  });

  console.log(`[INH] ${track}: ${raceNumbers.length} races (${raceNumbers.join(', ')})`);

  const races = [];
  for (const raceNum of raceNumbers) {
    // Click tab
    await page.evaluate((num) => {
      for (const btn of document.querySelectorAll('button')) {
        if (btn.textContent?.trim() === `C${num}`) { btn.click(); return; }
      }
    }, raceNum);
    await new Promise(r => setTimeout(r, 1200));

    // Extract horses
    const horses = await page.evaluate(() => {
      const result = [];
      for (const row of document.querySelectorAll('[class*="races-tab-grid"]')) {
        const children = Array.from(row.children);
        const textValues = children.map(el => el.textContent?.trim() || '');
        const numIdx = textValues.findIndex(t => /^\d+$/.test(t));
        if (numIdx === -1) continue;

        const programNumber = textValues[numIdx];

        // Dividend: element with text-yellow class
        let dividend = '';
        for (const child of children) {
          const yellow = child.querySelector('[class*="text-yellow"]');
          if (yellow) { dividend = yellow.textContent?.trim() || ''; break; }
          if (child.className?.includes('text-yellow')) {
            dividend = child.textContent?.trim() || ''; break;
          }
        }

        // Horse name + jockey/trainer
        let horseName = '', jockey = '', trainer = '';
        for (const child of children) {
          const nameEl = child.querySelector('[class*="text-sm"]');
          if (nameEl) {
            horseName = nameEl.textContent?.trim() || '';
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
          if (child.className?.includes('text-sm')) {
            horseName = child.textContent?.trim() || '';
          }
        }

        // Weight: hidden grid child
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

    races.push({ raceNumber: raceNum, horses, track });
    if (raceNum % 5 === 0 || raceNum === raceNumbers[raceNumbers.length - 1]) {
      console.log(`[INH]   ${track} C${raceNum}: ${horses.length} horses`);
    }
  }

  return { track, races, raceNumbers };
}

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

    await login(page);
    await navigateToRaces(page);

    // ── Extract La Rinconada ──
    const lr = await extractRaces(page);
    const allRaces = [...lr.races];

    // ── Switch to Valencia and extract ──
    console.log('[INH] Switching to Valencia...');
    const switched = await switchTrack(page, 'Valencia');
    if (switched) {
      const val = await extractRaces(page);
      allRaces.push(...val.races);
    } else {
      console.log('[INH] Valencia not available, trying Santa Rita...');
      const switched2 = await switchTrack(page, 'Santa Rita');
      if (switched2) {
        const santa = await extractRaces(page);
        allRaces.push(...santa.races);
      }
    }

    // ── Build & send payload ──
    const program = allRaces.map(r => ({
      raceNumber: r.raceNumber,
      track: r.track,
      raceTime: '',
      statusText: 'ABIERTA'
    }));

    const payload = { program, races: allRaces, isRunning: true };
    const totalHorses = allRaces.reduce((s, r) => s + r.horses.length, 0);
    console.log(`[INH] Sending ${allRaces.length} races, ${totalHorses} horses (${[...new Set(allRaces.map(r => r.track))].join(', ')})`);

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
