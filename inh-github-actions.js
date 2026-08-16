import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import axios from 'axios';

puppeteer.use(StealthPlugin());

const RENDER_URL = process.env.RENDER_URL || 'https://resultados-web.onrender.com';
const API_KEY = process.env.RENDER_API_KEY;
const INH_USER = process.env.INH_USER;
const INH_PASS = process.env.INH_PASS;

// Render free tier se duerme tras ~15 min sin tráfico; al despertar el frío devuelve
// "Internal server error (Correlation ID)". Reintentamos las llamadas al server para
// que el cold start no convierta un run intermitente en fallo.
async function requestWithRetry(fn, { attempts = 4, delayMs = 10000, timeoutMs = 60000 } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn({ timeout: timeoutMs });
    } catch (err) {
      lastErr = err;
      console.log(`[INH] Intento ${i}/${attempts} falló (${err.message}); reintentando en ${delayMs / 1000}s...`);
      if (i < attempts) await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

// The SSR page renders all times 4 hours behind (timezone bug in Next.js).
// Add 4 hours to correct them.
function fixTime(timeStr) {
  if (!timeStr) return '';
  const m = timeStr.match(/(\d{1,2}):(\d{2})\s*([ap])\.?\s*m/i);
  if (!m) return timeStr;
  let h = parseInt(m[1]);
  const min = m[2];
  const mer = m[3].toLowerCase();
  if (mer === 'p' && h !== 12) h += 12;
  if (mer === 'a' && h === 12) h = 0;
  h = (h + 4) % 24;
  const newMer = h >= 12 ? 'p. m.' : 'a. m.';
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return `${h.toString().padStart(2, '0')}:${min} ${newMer}`;
}

const MONTHS = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12
};

const MONTH_NAMES = {
  1: 'Enero', 2: 'Febrero', 3: 'Marzo', 4: 'Abril', 5: 'Mayo', 6: 'Junio',
  7: 'Julio', 8: 'Agosto', 9: 'Septiembre', 10: 'Octubre', 11: 'Noviembre', 12: 'Diciembre'
};

const DAY_NAMES = {
  0: 'Domingo', 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado'
};

// Current Venezuela date (UTC-4) as YYYY-MM-DD, optionally offset by days.
function vetDateStr(offsetDays = 0) {
  const d = new Date(Date.now() - 4 * 3600000);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().split('T')[0];
}

// Parse the header text of an OPEN race ("Hoy · 2 de agosto de 2026",
// "Mañana · ...", "Domingo · 2 de agosto de 2026") into a canonical
// YYYY-MM-DD. The literal date always wins; "Hoy"/"Mañana" are only a
// fallback when no literal date is present.
function parseTrackFecha(infoText) {
  if (!infoText) return null;
  const dm = infoText.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
  if (dm) {
    const month = MONTHS[dm[2].toLowerCase()];
    const day = parseInt(dm[1]);
    const year = parseInt(dm[3]);
    if (month && day && year) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  if (/(^|\s)hoy(\s|$)/i.test(infoText)) return vetDateStr(0);
  if (/(^|\s)(mañana|manana)(\s|$)/i.test(infoText)) return vetDateStr(1);
  return null;
}

// "2026-08-02" -> "Domingo 2 de agosto de 2026"
function formatRaceDate(fecha) {
  if (!fecha) return '';
  const [y, m, d] = fecha.split('-').map(Number);
  const wd = DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd} ${d} de ${MONTH_NAMES[m]} ${y}`;
}

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

// Clic a la pestaña de una carrera. React "adopta" el DOM SSR del tab inicial
// sin re-renderizar; por eso se clica primero OTRA pestaña para forzar a React
// a descartar el SSR y luego la pestaña objetivo (datos frescos del API).
async function clickRaceTab(page, raceNum, raceNumbers) {
  if (raceNumbers.length > 1) {
    const otherNum = raceNum === raceNumbers[0] ? raceNumbers[1] : raceNumbers[0];
    await page.evaluate((num) => {
      for (const btn of document.querySelectorAll('button')) {
        const t = (btn.textContent || '').trim();
        if (t === `C${num}` || t === `Carrera ${num}` || t === `C ${num}`) { btn.click(); return; }
      }
    }, otherNum);
    await new Promise(r => setTimeout(r, 300));
  }
  // Now click the target tab — React will fetch fresh data from the API
  await page.evaluate((num) => {
    for (const btn of document.querySelectorAll('button')) {
      const t = (btn.textContent || '').trim();
      if (t === `C${num}` || t === `Carrera ${num}` || t === `C ${num}`) { btn.click(); return; }
    }
  }, raceNum);
  // Wait for API calls (race data) to complete and React to hydrate
  try {
    await page.waitForNetworkIdle({ idleTime: 800, timeout: 8000 });
  } catch (_) {}
  await new Promise(r => setTimeout(r, 500));
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

  // Get race numbers from tabs (broad matching: "C1", "C 1", "Carrera 1")
  const raceNumbers = await page.evaluate(() => {
    const nums = [];
    const collect = (els) => {
      for (const el of els) {
        const t = (el.textContent || '').trim();
        let m = t.match(/^C\s*(\d{1,2})$/i);
        if (!m) m = t.match(/^Carrera\s*(\d{1,2})$/i);
        if (m) {
          const n = parseInt(m[1]);
          if (!nums.includes(n)) nums.push(n);
        }
      }
    };
    collect(document.querySelectorAll('button'));
    collect(document.querySelectorAll('[role="tab"], a, [class*="tab"]'));
    return nums.sort((a, b) => a - b);
  });

  console.log(`[INH] ${track}: ${raceNumbers.length} races (${raceNumbers.join(', ')})`);

  // ── Diagnostic: if no races were found, dump the page state ──
  if (raceNumbers.length === 0) {
    const diag = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const leafC = Array.from(document.querySelectorAll('*'))
        .filter(el => el.children.length === 0 && /C\s*\d/i.test((el.textContent || '').trim()))
        .map(el => (el.textContent || '').trim())
        .slice(0, 20);
      return {
        url: location.href,
        trigger: document.querySelector('[data-slot="select-value"]')?.textContent?.trim() || '',
        buttonsCount: buttons.length,
        buttons: buttons.map(b => (b.textContent || '').trim()).slice(0, 40),
        leafC,
        bodyHead: document.body.innerText.slice(0, 1000)
      };
    });
    console.log('[INH] DIAG 0 races:', JSON.stringify(diag));
  }

  const races = [];
  for (const raceNum of raceNumbers) {
    // Extract ALL data for this race, retrying while a closed race lacks results
    let raceData = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await clickRaceTab(page, raceNum, raceNumbers);
      raceData = await page.evaluate((num) => {
      const pageText = document.body.innerText;

      // ── Status, time & date ──
      let statusText = 'ABIERTA';
      let raceTime = '';
      let raceDate = '';
      let raceHeaderText = '';

      // Helper: check if element is visible (not display:none)
      const isVis = (el) => el.offsetParent !== null;

      // ── Closed races: find visible "CARRERA CERRADA" span ──
      const visibleSpans = Array.from(document.querySelectorAll('span')).filter(isVis);
      const statusSpan = visibleSpans.find(el => (el.textContent || '').trim() === 'CARRERA CERRADA');
      if (statusSpan) {
        statusText = 'CERRADA';
        const parent = statusSpan.closest('[class*="rounded-lg"]');
        if (parent) {
          const txt = parent.innerText || '';
          const m = txt.match(/(\d{1,2}:\d{2}\s*[ap]\.?\s*m\.?)/i);
          if (m) raceTime = m[1].trim();
        }
      }

      // ── Open races: header box carries the date
      //    ("Domingo · 2 de agosto de 2026" / "Hoy · ...") + time ──
      if (statusText === 'ABIERTA') {
        const dateSpan = visibleSpans.find(el =>
          /·?\s*\d{1,2}\s+de\s+\w+\s+de\s+\d{4}/i.test((el.textContent || '').trim())
        );
        const labelSpan = !dateSpan && visibleSpans.find(el => {
          const t = (el.textContent || '').trim();
          return t === 'Hoy' || t === 'Mañana';
        });
        const box = (dateSpan || labelSpan)?.closest('[class*="rounded-lg"]');
        if (box) {
          raceHeaderText = box.innerText || '';
          const ts = box.querySelector('[class*="tabular-nums"]');
          if (ts) {
            const t = ts.textContent?.trim() || '';
            if (/[ap]\.?\s*m/i.test(t)) raceTime = t;
          }
        }
      }

      // ── Ultra-fallback: regex on pageText ──
      if (!raceTime) {
        const tm = pageText.match(/Hora:\s*(\d{1,2}:\d{2}\s*[ap]\.?\s*m\.?)/i);
        if (tm) raceTime = tm[1].trim();
      }

      // ── Horses from race grid ──
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
        const rowCls = row.className || '';
        const isScratched = !!(rowCls.includes('line-through') || rowCls.includes('opacity') ||
          row.querySelector('s, del, [class*="line-through"], [class*="retirado"], [style*="line-through"], [style*="opacity"]') ||
          /\bRETIRADO\b/i.test(row.outerHTML));
        horses.push({ programNumber, horseName, dividend, jockey, trainer, weight, isScratched });
      }

      // ── Scratched horses outside the grid (opacity-50 + line-through + "Retirado") ──
      for (const row of document.querySelectorAll('[class*="opacity-50"]')) {
        if (row.querySelector('[class*="races-tab-grid"]')) continue;
        const numSpan = row.querySelector('[class*="rounded"]');
        const nameSpan = row.querySelector('.line-through, [class*="line-through"]');
        if (numSpan && nameSpan) {
          const pn = numSpan.textContent?.trim() || '';
          if (/^\d+$/.test(pn) && !horses.find(h => h.programNumber === pn)) {
            horses.push({ programNumber: pn, horseName: nameSpan.textContent?.trim() || '', dividend: '', jockey: '', trainer: '', weight: '', isScratched: true });
          }
        }
      }

      // ── Results from page text ──
      const resultRows = [];
      const exoticDividends = {};

      // Find results section for this race: between "Resultados C{N}" and next "Resultados C" or end
      const headerIdx = pageText.indexOf(`Resultados C${num}`);
      if (num === 4) console.log(`[C4 DEBUG] headerIdx=${headerIdx}, status=${statusText}, horses=${document.querySelectorAll('[class*="races-tab-grid"]').length} rows`);
      if (headerIdx !== -1) {
        const nextHeader = pageText.indexOf('Resultados C', headerIdx + 1);
        const sectionEnd = nextHeader !== -1 ? nextHeader : headerIdx + 3000;
        const section = pageText.substring(headerIdx, sectionEnd);
        const lines = section.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          // Position line: "1°" on its own line
          const posMatch = line.match(/^(\d+)°$/);
          if (!posMatch) continue;
          const position = parseInt(posMatch[1]);
          // Next line: program number
          const numLine = lines[i + 1]?.trim() || '';
          if (!/^\d+$/.test(numLine)) continue;
          // Next line: horse name
          const nameLine = lines[i + 2]?.trim() || '';
          // Next lines: ganador, place (or mobile combined "G: X P: Y")
          const ganLine = lines[i + 3]?.trim() || '';
          const plaLine = lines[i + 4]?.trim() || '';
          let ganador = '', place = '';
          const gpMatch = ganLine.match(/^G[:\s]*([\d.,]+)\s+P[:\s]*([\d.,]+)/i);
          if (gpMatch) {
            ganador = gpMatch[1]; place = gpMatch[2];
          } else {
            if (/^[\d.,]+$/.test(ganLine) && ganLine !== '-') ganador = ganLine;
            if (/^[\d.,]+$/.test(plaLine) && plaLine !== '-') place = plaLine;
          }
          resultRows.push({ position, programNumber: numLine, horseName: nameLine, ganador, place });
        }

        // ── Exotic dividends from DOM ──
        // Find the parent container for this race by looking for the space-y-3 div
        // that contains "Resultados C{num}" and then find "Jugadas Exóticas" within it
        const raceContainers = document.querySelectorAll('[class*="space-y-3"]');
        for (const container of raceContainers) {
          const containerText = container.textContent || '';
          if (!containerText.includes(`Resultados C${num}`)) continue;
          // Find the exotic header within this container
          for (const child of container.children) {
            const firstText = child.firstElementChild?.textContent?.trim() || '';
            if (firstText === 'Jugadas Exóticas') {
              // This is the exotic container
              const items = Array.from(child.children).slice(1); // skip header
              for (const item of items) {
                const nameEl = item.querySelector('[class*="font-medium"]');
                const valueEl = item.querySelector('[class*="text-green"]');
                if (nameEl && valueEl) {
                  let ename = nameEl.textContent.trim();
                  // Strip trailing parenthetical like "(04-01-06-03)"
                  ename = ename.replace(/\s*\([^)]*\)\s*$/, '').trim();
                  if (ename) exoticDividends[ename] = valueEl.textContent.trim();
                }
              }
              break;
            }
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

      return { horses, statusText, raceTime, raceDate, raceHeaderText, exoticDividends };
    }, raceNum);

      // Una carrera CERRADA que aún no muestra posiciones suele significar que
      // el sitio publica el bloque "Resultados C{N}" unos minutos después de la
      // etiqueta "CARRERA CERRADA". Reintentar en el mismo run (más espera
      // progresiva) en vez de esperar el siguiente ciclo de cron.
      const hasPositions = Array.isArray(raceData.horses) && raceData.horses.some(h => h && h.position);
      if (raceData.statusText === 'CERRADA' && raceData.horses.length > 0 && !hasPositions) {
        if (attempt < 3) {
          console.log(`[INH] ${track} C${raceNum}: CERRADA sin posiciones (intento ${attempt}/3), reintentando...`);
          await new Promise(r => setTimeout(r, 3000 * attempt));
          continue;
        }
        console.log(`[INH] ${track} C${raceNum}: CERRADA sin posiciones tras 3 intentos`);
      }
      break;
    }

    // SSR renders all times 4 hours behind (Next.js timezone bug)
    if (raceData.raceTime) raceData.raceTime = fixTime(raceData.raceTime);
    const raceFecha = parseTrackFecha(raceData.raceHeaderText) || '';

    if (raceNum === 1) console.log(`[INH DEBUG] ${track} C${raceNum}: status="${raceData.statusText}" time="${raceData.raceTime}" fecha="${raceFecha}" horses=${raceData.horses.length}`);

    races.push({
      raceNumber: raceNum,
      horses: raceData.horses,
      track,
      statusText: raceData.statusText,
      raceTime: raceData.raceTime,
      raceDate: raceFecha ? formatRaceDate(raceFecha) : '',
      fecha: raceFecha,
      dividends: raceData.exoticDividends || {}
    });
    if (raceNum % 3 === 0 || raceNum === raceNumbers[raceNumbers.length - 1]) {
      console.log(`[INH]   ${track} C${raceNum}: ${raceData.horses.length} horses, ${raceData.statusText}${raceData.raceTime ? ' ' + raceData.raceTime : ''}${Object.keys(raceData.exoticDividends).length ? ', exóticas:' + Object.keys(raceData.exoticDividends).join(',') : ''}`);
    }
  }

  // Track-level date: taken from any open race (closed races have no header).
  // Closed races inherit it.
  const trackFecha = races.find(r => r.fecha)?.fecha || '';
  for (const r of races) {
    if (!r.fecha) r.fecha = trackFecha;
    if (!r.raceDate && trackFecha) r.raceDate = formatRaceDate(trackFecha);
  }
  const withPositions = races.map(r => ({ n: r.raceNumber, pos: (r.horses || []).filter(h => h.position).length }))
    .filter(x => x.pos > 0);
  console.log(`[INH] ${track}: ${races.length} races, fecha=${trackFecha || '(sin fecha, todo cerrado)'} | carreras con posiciones: ${withPositions.length}`);
  if (withPositions.length) console.log('[INH]   posiciones por carrera:', withPositions.map(x => `C${x.n}=${x.pos}`).join(', '));
  return { track, races, raceNumbers, fecha: trackFecha };
}

async function fetchServerJornada() {
  if (!API_KEY) return null;
  try {
    // Use the existing /api/inh endpoint (works on any deployed version);
    // it returns today's races from the server, from which we derive tracks.
    const resp = await requestWithRetry(({ timeout }) => axios.get(`${RENDER_URL}/api/inh`, {
      headers: { 'x-api-key': API_KEY },
      timeout
    }));
    const data = resp.data || {};
    const races = Array.isArray(data.races) ? data.races : [];
    const tracks = [];
    for (const r of races) {
      const t = r.track || r.hippodromo;
      if (t && !tracks.includes(t)) tracks.push(t);
    }
    const out = { fecha: data.fecha || '', tracks, hasPrograma: races.length > 0 };
    console.log('[INH] Jornada del servidor (vía /api/inh):', JSON.stringify(out));
    return out;
  } catch (err) {
    console.log(`[INH] No se pudo consultar la jornada del servidor: ${err.message}`);
    return null;
  }
}

// Avisa al servidor que ya se verificó que hoy no hay jornada (marca la ventana).
async function reportDiscoveryChecked() {
  if (!API_KEY) return;
  const now = new Date(Date.now() - 4 * 3600000); // VET = UTC-4
  const m = now.getUTCHours() * 60 + now.getUTCMinutes();
  const inMorning = m >= 8 * 60 && m < 8 * 60 + 30;
  const inAfternoon = m >= 18 * 60 && m < 18 * 60 + 30;
  if (!inMorning && !inAfternoon) {
    console.log('[INH] discovery-checked omitido: fuera de ventana de descubrimiento');
    return;
  }
  const ventana = inAfternoon ? 'afternoon' : 'morning';
  try {
    const resp = await requestWithRetry(({ timeout }) => axios.post(
      `${RENDER_URL}/api/inh/discovery-checked`,
      { ventana },
      { headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY }, validateStatus: s => s < 500, timeout }
    ));
    console.log(`[INH] discovery-checked (${ventana}) -> HTTP ${resp.status}`);
  } catch (err) {
    console.error(`[INH] discovery-checked falló: ${err.message}`);
  }
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

    // Log API responses to discover where race times come from
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/api/') || url.includes('/_next/')) {
        try {
          const txt = await response.text();
          if (txt.length > 20 && txt.length < 50000 && (txt.includes('hora') || txt.includes('race') || txt.includes('carrera'))) {
            console.log('[INH API]', url.slice(0, 150), '|', txt.slice(0, 600));
          }
        } catch {}
      }
    });

    // ── La página puede iniciar sin hipódromo seleccionado ──
    // ("Seleccionar hipódromo..."), así que forzamos La Rinconada.
    console.log('[INH] Asegurando hipódromo La Rinconada...');
    await switchTrack(page, 'La Rinconada');

    // ── Extract La Rinconada ──
    let lr = await extractRaces(page);

    // If La Rinconada still empty, reload and retry once
    if (!lr.races.length) {
      console.log('[INH] La Rinconada vacío; recargando la página y reintentando...');
      await page.reload({ waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 5000));
      await switchTrack(page, 'La Rinconada');
      lr = await extractRaces(page);
    }

    // ── Switch to Valencia (or Santa Rita) and extract ──
    console.log('[INH] Switching to Valencia...');
    const switched = await switchTrack(page, 'Valencia');
    let val = null, santa = null;
    if (switched) {
      val = await extractRaces(page);
    } else {
      console.log('[INH] Valencia not available, trying Santa Rita...');
      const switched2 = await switchTrack(page, 'Santa Rita');
      if (switched2) santa = await extractRaces(page);
    }

    // ── Keep today's (or upcoming future) jornada ──
    // A track is TODAY when it has an OPEN race (closed races lose their date).
    // An OPEN race on a future date = the upcoming jornada (published days before),
    // stored under its real fecha. All-closed tracks fall back to the server's
    // known today ONLY if the server confirms its jornada is today, so an old
    // orphaned jornada (e.g. Valencia) is never sent.
    const todayStr = vetDateStr(0);
    const tracks = [lr, val, santa].filter(Boolean);

    const needsServer = tracks.some(t => !t.races.some(r => r.statusText === 'ABIERTA'));
    const serverJornada = needsServer ? await fetchServerJornada() : null;
    // Solo confirmar como HOY si el servidor dice que su jornada coincide con HOY
    const serverIsToday = !!serverJornada && serverJornada.fecha === todayStr;
    const serverTodayTracks = (serverJornada?.tracks || [])
      .map(n => (n || '').trim().toLowerCase()).filter(Boolean);

    const allRaces = [];
    for (const t of tracks) {
      const trackKey = (t.track || '').trim().toLowerCase();
      const hasOpen = t.races.some(r => r.statusText === 'ABIERTA');
      let effFecha = t.fecha || '';

      if (hasOpen) {
        if (effFecha && effFecha > todayStr) {
          console.log(`[INH] ${t.track}: jornada publicada para el ${effFecha}`);
        } else {
          effFecha = todayStr;
          console.log(`[INH] ${t.track}: jornada actual detectada por carrera ABIERTA`);
        }
      } else if (!hasOpen && !effFecha && serverIsToday && serverTodayTracks.includes(trackKey)) {
        effFecha = todayStr;
        console.log(`[INH] ${t.track}: todo cerrado pero confirmado como HOY por el servidor`);
      }

      if (!effFecha) {
        console.log(`[INH] ${t.track}: omitida (sin fecha reconocida / no confirmada hoy)`);
        continue;
      }
      if (effFecha < todayStr) {
        console.log(`[INH] ${t.track}: omitida (jornada pasada ${effFecha})`);
        continue;
      }
      allRaces.push(...t.races);
    }

    const anyRaces = tracks.reduce((s, t) => s + (t.races || []).length, 0);

    // ── Group by canonical date & send one payload per jornada ──
    if (allRaces.length === 0) {
      console.warn('[INH] Sin jornadas hoy ni futuras; no se envía nada');
      // Si la extracción sí cargó carreras (solo jornada pasada/cerrada) y es una
      // ventana de descubrimiento, avisar al servidor para no pedir más hoy.
      if (anyRaces > 0) {
        console.log('[INH] Reportando discovery-checked...');
        await reportDiscoveryChecked();
      }
    } else {
      const byFecha = {};
      for (const r of allRaces) {
        const d = r.fecha || todayStr;
        if (!byFecha[d]) byFecha[d] = [];
        byFecha[d].push(r);
      }
      if (!API_KEY) throw new Error('Falta RENDER_API_KEY');
      for (const [fecha, races] of Object.entries(byFecha)) {
        const program = races.map(r => ({
          raceNumber: r.raceNumber,
          track: r.track,
          raceTime: r.raceTime || '',
          raceDate: r.raceDate || '',
          statusText: r.statusText || 'ABIERTA',
          fecha
        }));
        const payload = { fecha, program, races, isRunning: true };
        const totalHorses = races.reduce((s, r) => s + r.horses.length, 0);
        const totalPos = races.reduce((s, r) => s + (r.horses || []).filter(h => h.position).length, 0);
        console.log(`[INH] Sending ${races.length} races for ${fecha}, ${totalHorses} horses (${[...new Set(races.map(r => r.track))].join(', ')}), posiciones=${totalPos}`);
        try {
          // validateStatus < 500 hace que un 5xx (p. ej. cold start de Render) lance
          // error, que requestWithRetry captura y reintenta automáticamente.
          const resp = await requestWithRetry(({ timeout }) => axios.post(`${RENDER_URL}/api/inh/data`, payload, {
            headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
            validateStatus: s => s < 500,
            timeout
          }));
          console.log(`[INH] POST ${fecha} -> HTTP ${resp.status}`);
        } catch (err) {
          console.error(`[INH] POST ${fecha} falló: ${err.message}`);
        }
      }
      console.log('[INH] Data sent OK');
    }

  } finally {
    await browser.close();
  }
}

run().catch(e => {
  console.error('[INH] Error:', e.message);
  process.exit(1);
});
