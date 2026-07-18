import puppeteer from 'puppeteer';
import axios from 'axios';

const RENDER_URL = process.env.RENDER_URL || 'https://resultados-web.onrender.com';
const API_KEY = process.env.RENDER_API_KEY;

async function run() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--single-process', '--no-zygote']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36');

    await page.goto('https://apuestas.inh.gob.ve', { waitUntil: 'networkidle2', timeout: 60000 });

    try {
      await page.waitForSelector('button:has-text("Iniciar Sesión")', { timeout: 10000 });
      await page.click('button:has-text("Iniciar Sesión")');
    } catch {
      try {
        await page.waitForSelector('button:has-text("Ingresar")', { timeout: 5000 });
        await page.click('button:has-text("Ingresar")');
      } catch {
        throw new Error('No se encontró botón de inicio de sesión');
      }
    }

    await page.waitForSelector('input[name="username"]', { timeout: 10000 });
    await page.type('input[name="username"]', process.env.INH_USER);
    await page.type('input[name="password"]', process.env.INH_PASS);
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });

    await page.goto('https://apuestas.inh.gob.ve/apuestas/nacional', { waitUntil: 'networkidle2', timeout: 30000 });

    const program = await page.evaluate(() => {
      const tracks = document.querySelectorAll('[class*="track-card"], [class*="TrackCard"]');
      const data = [];
      tracks.forEach(track => {
        const trackName = track.querySelector('[class*="track-name"], [class*="trackName"]')?.textContent?.trim();
        const races = track.querySelectorAll('[class*="race-card"], [class*="RaceCard"]');
        races.forEach(race => {
          const raceNumber = race.querySelector('[class*="race-number"], [class*="raceNumber"]')?.textContent?.trim();
          const raceTime = race.querySelector('[class*="race-time"], [class*="raceTime"]')?.textContent?.trim();
          const statusEl = race.querySelector('[class*="status"]');
          const statusText = statusEl?.textContent?.trim() || '';
          const statusId = statusText.includes('ABIERTA') ? '1' : statusText.includes('CERRADA') ? '7' : '0';
          if (raceNumber) {
            data.push({ track: trackName || 'Desconocido', raceNumber, raceTime, statusId, statusText });
          }
        });
      });
      return data;
    });

    const races = await page.evaluate(() => {
      const raceCards = document.querySelectorAll('[class*="race-card"], [class*="RaceCard"]');
      const results = [];
      raceCards.forEach(race => {
        const raceNumber = race.querySelector('[class*="race-number"], [class*="raceNumber"]')?.textContent?.trim();
        if (!raceNumber) return;
        const statusEl = race.querySelector('[class*="status"]');
        const statusText = statusEl?.textContent?.trim() || '';
        const isClosed = statusText.includes('CERRADA');
        const isOpen = statusText.includes('ABIERTA');
        const horses = [];
        const rows = race.querySelectorAll('table tbody tr, [class*="horse-row"]');
        rows.forEach(row => {
          const programNumber = row.querySelector('td:first-child, [class*="number"]')?.textContent?.trim();
          const horseName = row.querySelector('[class*="horse-name"], [class*="horseName"]')?.textContent?.trim();
          const position = row.querySelector('[class*="position"]')?.textContent?.trim();
          if (programNumber) {
            horses.push({
              programNumber,
              horseName: horseName || '',
              position: position || null,
              isScratched: row.querySelector('[class*="status"]')?.textContent?.toLowerCase().includes('retirado') || false,
              status: ''
            });
          }
        });
        const dividends = {};
        race.querySelectorAll('[class*="dividend"]').forEach(item => {
          const label = item.querySelector('[class*="label"]')?.textContent?.trim();
          const value = item.querySelector('[class*="value"]')?.textContent?.trim();
          if (label && value) dividends[label] = value;
        });
        const exotics = {};
        race.querySelectorAll('[class*="exotic"]').forEach(item => {
          const name = item.querySelector('[class*="exotic-name"]')?.textContent?.trim();
          const combo = item.querySelector('[class*="exotic-combo"]')?.textContent?.trim();
          const payout = item.querySelector('[class*="exotic-payout"]')?.textContent?.trim();
          if (name) exotics[name] = { combo: combo || null, payout: payout || null };
        });
        results.push({ raceNumber, isOpen, isClosed, statusText, horses, dividends, exotics });
      });
      return results;
    });

    const payload = { program, races, isRunning: true };
    console.log(`[INH] ${program.length} carreras, ${races.length} con datos`);

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
