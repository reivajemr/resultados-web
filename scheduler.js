import {
  fetchLottoActivo,
  fetchGuacharito,
  fetchLaGranjitaFromAPI,
  fetchLaGranjitaFallback,
  fetchLottoActivoFallback,
  fetchGuacharitoFallback
} from './proxies.js';

const VET_OFFSET = -4 * 60 * 60 * 1000;
const DRAW_DELAY_MS = 5 * 60 * 1000;
const RETRY_INTERVAL_MS = 5 * 60 * 1000;
const MAX_RETRIES = 3;

const GAMES = [
  {
    id: 'lotto_activo',
    name: 'Lotto Activo',
    source: 'lottoactivo',
    schedule: ['08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00']
  },
  {
    id: 'la_granjita',
    name: 'La Granjita',
    source: 'lagranjita',
    schedule: ['08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00']
  },
  {
    id: 'el_guacharito',
    name: 'El Guacharito Millonario',
    source: 'guacharito',
    schedule: ['08:30','09:30','10:30','11:30','12:30','13:30','14:30','15:30','16:30','17:30','18:30','19:30']
  },
  {
    id: 'lotto_activo_2',
    name: 'Lotto Activo 2 (Monje Millonario)',
    source: 'lottoactivo',
    schedule: ['08:05','09:05','10:05','11:05','12:05','13:05','14:05','15:05','16:05','17:05','18:05','19:05']
  },
  {
    id: 'trio_activo',
    name: 'Trío Activo',
    source: 'lottoactivo',
    schedule: ['08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00']
  },
  {
    id: 'terminal_activo',
    name: 'Terminal Trío',
    source: 'lottoactivo',
    schedule: ['08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00']
  }
];

class AnimalitosScheduler {
  constructor({ loteriaEmail, loteriaPassword, db }) {
    this.loteriaEmail = loteriaEmail;
    this.loteriaPassword = loteriaPassword;
    this.db = db;
    this.intervalId = null;

    this.state = {};
    this.cache = {};
  }

  _getTodayStr() {
    const d = new Date(Date.now() + VET_OFFSET);
    return d.toISOString().split('T')[0];
  }

  _getDateStr(date) {
    return date.toISOString().split('T')[0];
  }

  _parseTime(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    const nowVET = new Date(Date.now() + VET_OFFSET);
    const utcMs = Date.UTC(
      nowVET.getUTCFullYear(),
      nowVET.getUTCMonth(),
      nowVET.getUTCDate(),
      h, m, 0, 0
    );
    return new Date(utcMs - VET_OFFSET);
  }

  _getInitialStateForGame(gameId) {
    const game = GAMES.find(g => g.id === gameId);
    if (!game) return {};
    const today = this._getTodayStr();
    const state = {};
    for (const time of game.schedule) {
      state[time] = {
        status: 'pending',
        result: null,
        attempts: 0,
        lastAttempt: null,
        error: null
      };
    }
    return state;
  }

  _shouldFetch(sorteo, scheduleTime) {
    if (sorteo.status === 'completed' || sorteo.status === 'failed') return false;

    const now = Date.now();
    const firstFetchTime = scheduleTime.getTime() + DRAW_DELAY_MS;

    if (now < firstFetchTime) return false;

    if (sorteo.attempts === 0) return true;

    if (sorteo.attempts >= MAX_RETRIES) return false;

    if (!sorteo.lastAttempt) return true;

    const nextRetryTime = new Date(sorteo.lastAttempt).getTime() + RETRY_INTERVAL_MS;
    return now >= nextRetryTime;
  }

  async _executeFetch(game) {
    const today = this._getTodayStr();
    const dateCompact = today.replace(/-/g, '');
    let results;

    switch (game.source) {
      case 'lottoactivo':
        results = await fetchLottoActivo(game.id, today);
        if (!results?.length) {
          results = await fetchLottoActivoFallback(this.loteriaEmail, this.loteriaPassword, dateCompact);
        }
        break;
      case 'guacharito':
        results = await fetchGuacharito(today);
        if (!results?.length) {
          results = await fetchGuacharitoFallback(this.loteriaEmail, this.loteriaPassword, dateCompact);
        }
        break;
      case 'lagranjita':
        results = await fetchLaGranjitaFromAPI(today);
        if (!results?.length) {
          console.log(`[${game.id}] Primary (lagranjita.com) sin datos, usando fallback LoteriaDeHoy`);
          results = await fetchLaGranjitaFallback(this.loteriaEmail, this.loteriaPassword, dateCompact);
        } else {
          console.log(`[${game.id}] OK: ${results.length} resultados desde lagranjita.com`);
        }
        break;
      default:
        return null;
    }

    return results;
  }

  _parseTime24(timeStr) {
    const parts = timeStr.match(/(\d+):(\d+)\s*(AM|PM)?/i);
    if (!parts) return null;
    let h = parseInt(parts[1]);
    const m = parseInt(parts[2]);
    const ampm = parts[3]?.toUpperCase();
    if (ampm === 'PM' && h < 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    return { h, m };
  }

  _extractLottoActivoResult(data, gameId, time) {
    if (!data || data.length === 0) return null;
    const [tH, tM] = time.split(':').map(Number);
    const found = [];
    for (const item of data) {
      const timeStr = item.time_s || item.time || item.result_time;
      if (!timeStr) continue;
      const parsed = this._parseTime24(timeStr);
      if (!parsed) continue;
      if (parsed.h === tH && parsed.m === tM) {
        found.push(item);
      }
    }
    if (found.length === 0) return null;
    const item = found[0];
    const number = item.number_animal || item.number || item.giveaway_results_number_literal || item.resultado1;
    const animal = item.name_animal || item.animal || item.giveaway_results_literal;
    return {
      number,
      animal,
      color: item.color_animal || item.giveaway_results_color,
      time: item.time_s || item.time || item.result_time,
      raw: item
    };
  }

  _extractGuacharitoResult(data, time) {
    if (!Array.isArray(data)) return null;
    for (const s of data) {
      const [sH, sM] = s.time.split(':').map(Number);
      const [tH, tM] = time.split(':').map(Number);
      if (sH === tH && sM === tM) {
        return {
          number: s.result,
          animal: null,
          color: null,
          time: s.time,
          raw: s
        };
      }
    }
    return null;
  }

  _extractLoteriaResult(data, time) {
    if (!Array.isArray(data)) return null;
    for (const s of data) {
      const rTime = s.result_time;
      if (!rTime) continue;
      const [rH, rM] = rTime.split(':').map(Number);
      const [tH, tM] = time.split(':').map(Number);
      if (rH === tH && rM === tM) {
        return {
          number: s.giveaway_results_number_literal,
          animal: s.giveaway_results_literal,
          color: s.giveaway_results_color,
          time: rTime,
          image: s.giveaway_results_image,
          literals: s.Literals,
          raw: s
        };
      }
    }
    return null;
  }

  async tick() {
    const today = this._getTodayStr();

    if (!this.state[today]) {
      this.state[today] = {};
      this.cache[today] = {};
      for (const game of GAMES) {
        this.state[today][game.id] = this._getInitialStateForGame(game.id);
        this.cache[today][game.id] = { results: {}, game };
      }
    }

    const now = new Date();

    for (const game of GAMES) {
      const todayState = this.state[today][game.id];
      const todayCache = this.cache[today][game.id];

      for (const time of game.schedule) {
        const scheduleTime = this._parseTime(time);
        const sorteo = todayState[time];

        if (!this._shouldFetch(sorteo, scheduleTime)) continue;

        try {
          const data = await this._executeFetch(game);
          let extracted = null;

          switch (game.source) {
            case 'lottoactivo':
              extracted = this._extractLottoActivoResult(data, game.id, time);
              break;
            case 'guacharito':
              extracted = this._extractGuacharitoResult(data, time);
              break;
            case 'lagranjita':
              extracted = this._extractLoteriaResult(data, time);
              break;
          }

          sorteo.lastAttempt = now.toISOString();
          sorteo.attempts++;

          if (extracted) {
            sorteo.status = 'completed';
            sorteo.result = extracted;
            todayCache.results[time] = extracted;
            if (this.db) {
              this.db.guardarResultado(game.id, today, time, extracted).catch(e =>
                console.error(`[DB] Error guardando ${game.id} ${time}:`, e.message)
              );
            }
          } else {
            if (sorteo.attempts >= MAX_RETRIES) {
              sorteo.status = 'failed';
              sorteo.error = 'No disponible tras 3 intentos';
            }
          }
        } catch (err) {
          sorteo.lastAttempt = now.toISOString();
          sorteo.attempts++;
          sorteo.error = err.message;

          if (sorteo.attempts >= MAX_RETRIES) {
            sorteo.status = 'failed';
          }
        }
      }
    }
  }

  async start() {
    if (this.db) {
      await this._loadFromDB();
      await this._saveMemoryCacheToDB();
    }
    this.tick();
    this.intervalId = setInterval(() => this.tick(), RETRY_INTERVAL_MS);
  }

  async _saveMemoryCacheToDB() {
    const now = Date.now();
    for (const dayKey of Object.keys(this.state)) {
      for (const game of GAMES) {
        const state = this.state[dayKey]?.[game.id];
        const dayCache = this.cache[dayKey]?.[game.id];
        if (!state || !dayCache) continue;
        for (const time of game.schedule) {
          const s = state[time];
          if (s?.status === 'completed' && s?.result) {
            try {
              await this.db.guardarResultado(game.id, dayKey, time, s.result);
            } catch (e) {
              console.error(`[DB] Error guardando caché ${game.id} ${dayKey} ${time}:`, e.message);
            }
          }
        }
      }
    }
  }

  async _loadFromDB() {
    const today = this._getTodayStr();
    this.state[today] = {};
    this.cache[today] = {};
    for (const game of GAMES) {
      this.state[today][game.id] = this._getInitialStateForGame(game.id);
      this.cache[today][game.id] = { results: {}, game };
      try {
        const rows = await this.db.cargarResultados(game.id, today);
        if (rows && rows.length > 0) {
          for (const row of rows) {
            const time = row.hora;
            if (this.state[today][game.id][time]) {
              this.state[today][game.id][time].status = 'completed';
              this.state[today][game.id][time].result = row.datos;
              this.cache[today][game.id].results[time] = row.datos;
            }
          }
          console.log(`[DB] Cargados ${rows.length} resultados para ${game.id}`);
        }
      } catch (e) {
        console.error(`[DB] Error cargando ${game.id}:`, e.message);
      }
    }
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async refetchDate(dayStr) {
    if (!this.db) return [];
    const results = [];
    const dateCompact = dayStr.replace(/-/g, '');
    for (const game of GAMES) {
      try {
        const existing = await this.db.cargarResultados(game.id, dayStr);
        if (existing?.length > 0) {
          results.push({ game: game.id, status: 'already_exists' });
          continue;
        }
        let data = null;
        switch (game.source) {
          case 'lottoactivo':
            data = await fetchLottoActivo(game.id, dayStr);
            if (!data?.length) data = await fetchLottoActivoFallback(this.loteriaEmail, this.loteriaPassword, dateCompact);
            break;
          case 'guacharito':
            data = await fetchGuacharito(dayStr);
            if (!data?.length) data = await fetchGuacharitoFallback(this.loteriaEmail, this.loteriaPassword, dateCompact);
            break;
          case 'lagranjita':
            data = await fetchLaGranjitaFromAPI(dayStr);
            if (!data?.length) data = await fetchLaGranjitaFallback(this.loteriaEmail, this.loteriaPassword, dateCompact);
            break;
        }
        if (!data) {
          console.log(`[${game.id}] Sin datos de ninguna fuente`);
          continue;
        }
        for (const time of game.schedule) {
          let extracted = null;
          switch (game.source) {
            case 'lottoactivo':
              extracted = this._extractLottoActivoResult(data, game.id, time);
              break;
            case 'guacharito':
              extracted = this._extractGuacharitoResult(data, time);
              break;
            case 'lagranjita':
              extracted = this._extractLoteriaResult(data, time);
              break;
          }
          if (extracted) {
            await this.db.guardarResultado(game.id, dayStr, time, extracted);
            results.push({ game: game.id, time, status: 'completed' });
          }
        }
      } catch (e) {
        console.error(`[${game.id}] Error en refetch: ${e.message}`);
      }
    }
    return results;
  }

  async backfillRecentDays(days = 2) {
    if (!this.db) return;
    const today = new Date(Date.now() + VET_OFFSET);
    for (let i = 1; i <= days; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dayStr = d.toISOString().split('T')[0];
      console.log(`[Backfill] Recuperando ${dayStr}...`);
      await this.refetchDate(dayStr);
    }
  }

  getResults() {
    const today = this._getTodayStr();
    if (!this.cache[today]) return [];

    const result = [];
    for (const game of GAMES) {
      const dayCache = this.cache[today];
      if (!dayCache || !dayCache[game.id]) continue;
      const state = this.state[today]?.[game.id];

      const draws = [];
      for (const time of game.schedule) {
        const r = dayCache[game.id].results[time];
        const s = state?.[time];
        draws.push({
          time,
          result: r || null,
          status: s?.status || 'pending',
          attempts: s?.attempts || 0,
          error: s?.error || null
        });
      }

      result.push({
        id: game.id,
        name: game.name,
        draws
      });
    }

    return result;
  }
}

export { GAMES };
export default AnimalitosScheduler;
