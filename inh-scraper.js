import puppeteer from 'puppeteer-core';

export class INHScraper {
  constructor({ username, password }) {
    this.username = username;
    this.password = password;
    this.browser = null;
    this.page = null;
    this.cache = {
      program: [],     
      races: {},       
      lastPoll: null,
      isRunning: false
    };
    this.pollInterval = null;
  }

  async start() {
    if (this.cache.isRunning) return;

    const launchOpts = {
      headless: true,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox',
        '--disable-gpu', '--single-process', '--no-zygote'
      ]
    };

    const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
    if (envPath) launchOpts.executablePath = envPath;

    this.browser = await puppeteer.launch(launchOpts);

    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1280, height: 800 });
    await this.page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    );

    await this.page.goto('https://apuestas.inh.gob.ve', {
      waitUntil: 'networkidle2', timeout: 60000
    });

    try {
      await this.page.waitForSelector('button:has-text("Iniciar Sesión")', { timeout: 10000 });
      await this.page.click('button:has-text("Iniciar Sesión")');
    } catch {
      try {
        await this.page.waitForSelector('button:has-text("Ingresar")', { timeout: 5000 });
        await this.page.click('button:has-text("Ingresar")');
      } catch {
        throw new Error('No se encontró botón de inicio de sesión');
      }
    }

    await this.page.waitForSelector('input[name="username"]', { timeout: 10000 });
    await this.page.type('input[name="username"]', this.username);
    await this.page.type('input[name="password"]', this.password);
    await this.page.click('button[type="submit"]');
    await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });

    await this.page.goto('https://apuestas.inh.gob.ve/apuestas/nacional', {
      waitUntil: 'networkidle2', timeout: 30000
    });

    this.cache.isRunning = true;
  }

  async getDailyProgram() {
    if (!this.page) throw new Error('Scraper no iniciado');

    try {
      await this.page.waitForSelector('[class*="race"]', { timeout: 15000 });
    } catch {
      this.cache.program = [];
      return [];
    }

    const program = await this.page.evaluate(() => {
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
          const statusId = statusText.includes('ABIERTA') ? '1'
            : statusText.includes('CERRADA') ? '7' : '0';

          if (raceNumber) {
            data.push({
              track: trackName || 'Desconocido',
              raceNumber,
              raceTime,
              statusId,
              statusText
            });
          }
        });
      });

      return data;
    });

    this.cache.program = program;
    return program;
  }

  async poll() {
    if (!this.page) return;
    this.cache.lastPoll = new Date();

    try {
      const racesData = await this.page.evaluate(() => {
        const races = document.querySelectorAll('[class*="race-card"], [class*="RaceCard"]');
        const results = [];

        races.forEach(race => {
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
            const status = row.querySelector('[class*="horse-status"], [class*="horseStatus"]')?.textContent?.trim();
            const isScratched = status?.toLowerCase().includes('retirado') ||
              status?.toLowerCase().includes('scratch');

            if (programNumber) {
              horses.push({
                programNumber,
                horseName: horseName || '',
                position: position || null,
                isScratched: !!isScratched,
                status: status || ''
              });
            }
          });

          const dividends = {};
          const divItems = race.querySelectorAll('[class*="dividend"]');
          divItems.forEach(item => {
            const label = item.querySelector('[class*="label"]')?.textContent?.trim();
            const value = item.querySelector('[class*="value"]')?.textContent?.trim();
            if (label && value) dividends[label] = value;
          });

          const exotics = {};
          const exoticItems = race.querySelectorAll('[class*="exotic"]');
          exoticItems.forEach(item => {
            const name = item.querySelector('[class*="exotic-name"]')?.textContent?.trim();
            const combo = item.querySelector('[class*="exotic-combo"]')?.textContent?.trim();
            const payout = item.querySelector('[class*="exotic-payout"]')?.textContent?.trim();
            if (name) exotics[name] = { combo: combo || null, payout: payout || null };
          });

          results.push({
            raceNumber,
            isOpen,
            isClosed,
            statusText,
            horses,
            dividends,
            exotics
          });
        });

        return results;
      });

      for (const r of racesData) {
        this.cache.races[r.raceNumber] = r;
      }
    } catch (err) {
      console.error('[INH] Error en poll:', err.message);
    }
  }

  async stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.cache.isRunning = false;
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  getCache() {
    return {
      program: this.cache.program,
      races: Object.values(this.cache.races),
      lastPoll: this.cache.lastPoll,
      isRunning: this.cache.isRunning
    };
  }
}
