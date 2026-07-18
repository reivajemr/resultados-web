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
  // Check current track name from the trigger button
  const currentTrack = await page.evaluate(() => {
    const trigger = document.querySelector('[data-slot="select-value"]');
    return trigger?.textContent?.trim() || '';
  });
  console.log(`[INH] Current track: "${currentTrack}" -> target: "${trackName}"`);
  if (currentTrack.toLowerCase() === trackName.toLowerCase()) return true;

  // Click the select trigger to open dropdown
  const clicked = await page.evaluate(() => {
    const trigger = document.querySelector('[data-slot="select-trigger"], button[role="combobox"]');
    if (!trigger) return false;
    trigger.click();
    return true;
  });

  if (!clicked) {
    console.log('[INH] Could not find track selector trigger');
    // Fallback: try navigating directly
    await page.goto('https://apuestas.inh.gob.ve/apuestas/nacional?hipodromo=' + encodeURIComponent(trackName), { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 5000));
    return true;
  }

  // Wait for dropdown portal to render
  await new Promise(r => setTimeout(r, 2500));

  // Find and click the option - Radix UI renders in a portal
  const selected = await page.evaluate((name) => {
    // Strategy 1: role="option" elements anywhere in the DOM
    let opts = document.querySelectorAll('[role="option"]');
    for (const opt of opts) {
      if (opt.textContent?.trim().toLowerCase() === name.toLowerCase()) {
        opt.click(); return true;
      }
    }

    // Strategy 2: data-slot="select-item"
    opts = document.querySelectorAll('[data-slot="select-item"]');
    for (const opt of opts) {
      if (opt.textContent?.trim().toLowerCase() === name.toLowerCase()) {
        opt.click(); return true;
      }
    }

    // Strategy 3: search all top-level body children for the portal
    const bodyChildren = document.body.children;
    for (let i = bodyChildren.length - 1; i >= 0; i--) {
      const el = bodyChildren[i];
      if (el.tagName === 'DIV' && el.querySelector) {
        const items = el.querySelectorAll('[role="option"], [data-slot="select-item"], [class*="select-item"]');
        for (const item of items) {
          if (item.textContent?.trim().toLowerCase() === name.toLowerCase()) {
            item.click(); return true;
          }
        }
      }
    }

    // Strategy 4: search all fixed/absolute positioned divs at the end
    const allDivs = document.querySelectorAll('div[style*="fixed"], div[style*="absolute"], div[style*="z-index"], div[role="listbox"]');
    for (const div of allDivs) {
      if (div.textContent?.trim().toLowerCase().includes(name.toLowerCase())) {
        const item = div.querySelector('[role="option"], [data-slot="select-item"]');
        if (item) { item.click(); return true; }
        // If the div itself is the option
        if (div.getAttribute('role') === 'option' || div.getAttribute('data-slot') === 'select-item') {
          div.click(); return true;
        }
      }
    }

    return false;
  }, trackName);

  if (!selected) {
    console.log(`[INH] Could not find "${trackName}" option in dropdown, trying click by coordinates...`);
    // Try clicking the trigger again with a different approach
    await page.evaluate((name) => {
      // Try dispatching a custom change event
      const trigger = document.querySelector('[data-slot="select-trigger"], button[role="combobox"]');
      if (trigger) {
        // Try clicking all items that contain the track name
        document.querySelectorAll('div, span, button').forEach(el => {
          if (el.textContent?.trim().toLowerCase() === name.toLowerCase() && el.offsetParent !== null) {
            el.click();
          }
        });
      }
    }, trackName);
    await new Promise(r => setTimeout(r, 3000));
  }

  // Wait for page to load new track data
  await new Promise(r => setTimeout(r, 5000));

  const verifyTrack = await page.evaluate(() => {
    const trigger = document.querySelector('[data-slot="select-value"]');
    return trigger?.textContent?.trim() || '';
  });
  console.log(`[INH] After switch, track is: "${verifyTrack}"`);
  return verifyTrack.toLowerCase() === trackName.toLowerCase();
}

async function extractRaces(page) {
  // Detect track from select trigger (case-insensitive)
  const track = await page.evaluate(() => {
    const trigger = document.querySelector('[data-slot="select-value"]');
    const text = trigger?.textContent?.trim() || document.body.innerText;
    const u = text.toUpperCase();
    if (u.includes('VALENCIA')) return 'Valencia';
    if (u.includes('SANTA RITA')) return 'Santa Rita';
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

    // Extract ALL data for this race (scoped to the active tab's DOM)
    const raceData = await page.evaluate((num) => {
      // Find the race grid and its parent container to scope searches
      const grid = document.querySelector('[class*="races-tab-grid"]');
      const container = grid?.closest('[class*="space-y"]') || grid?.parentElement || document.body;
      const containerText = container.textContent || '';

      // 1. Status & time from the container (not full page)
      let statusText = 'ABIERTA';
      let raceTime = '';
      const upper = containerText.toUpperCase();
      if (upper.includes('CARRERA CERRADA')) statusText = 'CERRADA';
      else if (upper.includes('CARRERA ABIERTA')) statusText = 'ABIERTA';
      const timeMatch = containerText.match(/Hora:\s*(\d{1,2}:\d{2}\s*[ap]\.?\s*m\.?)/i);
      if (timeMatch) raceTime = timeMatch[1].trim();
      else { const t2 = containerText.match(/Hora:\s*([^\n]+)/i); if (t2) raceTime = t2[1].trim(); }

      // 2. Extract horses from the race grid
      const horses = [];
      for (const row of document.querySelectorAll('[class*="races-tab-grid"]')) {
        const children = Array.from(row.children);
        const textValues = children.map(el => el.textContent?.trim() || '');
        const numIdx = textValues.findIndex(t => /^\d+$/.test(t));
        if (numIdx === -1) continue;
        const programNumber = textValues[numIdx];
        let dividend = '';
        for (const child of children) {
          const yellow = child.querySelector('[class*="text-yellow"]');
          if (yellow) { dividend = yellow.textContent?.trim() || ''; break; }
          if (child.className?.includes('text-yellow')) { dividend = child.textContent?.trim() || ''; break; }
        }
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
                      jockey = parts.slice(0, -1).join(' · ');
                      trainer = parts[parts.length - 1];
                    } else { jockey = txt; }
                    break;
                  }
                }
              }
            }
            break;
          }
          if (child.className?.includes('text-sm')) { horseName = child.textContent?.trim() || ''; }
        }
        let weight = '';
        for (const child of children) {
          const cls = child.className || '';
          if (cls.includes('hidden') && !child.textContent?.includes('Jockey') && !child.textContent?.includes('·')) {
            const wt = child.textContent?.trim() || '';
            if (/^[\d\.\-]+$/.test(wt) || wt === '-') { weight = wt; break; }
          }
        }
        horses.push({ programNumber, horseName, dividend, jockey, trainer, weight });
      }

      // 3. Results + exotic dividends from the NEXT sibling section
      const resultRows = [];
      const exoticDividends = {};
      const nextSection = container.nextElementSibling;
      if (nextSection) {
        const nextText = nextSection.textContent || '';
        // Look for position markers (1°, 2°, 3°...)
        const lines = nextText.split('\n');
        for (const line of lines) {
          const posMatch = line.match(/^\s*(\d+)°\s+/);
          if (posMatch) {
            const posNum = parseInt(posMatch[1]);
            // Find horse number in the same line (the first standalone number after position)
            const numMatch = line.match(/°\s*(\d+)/);
            if (numMatch) {
              const parts = line.trim().split(/\s{2,}/).filter(Boolean);
              const name = parts.find(p => p.length > 2 && !/^\d+$/.test(p) && !/^[\d.,]+$/.test(p)) || '';
              const gan = line.match(/G(?:anador)?[:\s]*([\d.,]+)/)?.[1] || '';
              const pla = line.match(/P(?:lace)?[:\s]*([\d.,]+)/)?.[1] || '';
              resultRows.push({ position: posNum, programNumber: numMatch[1], horseName: name.trim(), ganador: gan, place: pla });
            }
          }
          // Exotic plays: "Superfecta (04-01-06-03)  9.524,82 / Bs.40"
          const exoticMatch = line.match(/^(\w[\w\s]+?)\s+(?:\([^)]*\))?\s*([\d.,]+)\s*\/\s*Bs/i);
          if (exoticMatch) {
            exoticDividends[exoticMatch[1].trim()] = exoticMatch[2].trim();
          }
        }
      }

      // Apply positions to horses
      for (const result of resultRows) {
        const horse = horses.find(h => h.programNumber === result.programNumber);
        if (horse) {
          horse.position = result.position;
          if (result.ganador) horse.ganadorDividend = result.ganador;
          if (result.place) horse.placeDividend = result.place;
        }
      }

      return { horses, statusText, raceTime, exoticDividends };
    }, raceNum);

    races.push({
      raceNumber: raceNum,
      horses: raceData.horses,
      track,
      statusText: raceData.statusText,
      raceTime: raceData.raceTime,
      dividends: raceData.exoticDividends || {}
    });
    if (raceNum % 3 === 0 || raceNum === raceNumbers[raceNumbers.length - 1]) {
      console.log(`[INH]   ${track} C${raceNum}: ${raceData.horses.length} horses, ${raceData.statusText}${raceData.raceTime ? ' ' + raceData.raceTime : ''}${Object.keys(raceData.exoticDividends).length ? ', exóticas:' + Object.keys(raceData.exoticDividends).join(',') : ''}`);
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
      raceTime: r.raceTime || '',
      statusText: r.statusText || 'ABIERTA'
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
