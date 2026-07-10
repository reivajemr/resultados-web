import { fetchLottoActivo, fetchGuacharito, fetchLaGranjita, fetchLoteriaDeHoy } from './proxies.js';

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
  constructor({ loteriaEmail, loteriaPassword }) {
    this.loteriaEmail = loteriaEmail;
    this.loteriaPassword = loteriaPassword;
    this.intervalId = null;

    this.state = {};
    this.cache = {};
  }

  _getTodayStr() {
    const d = new Date();
    return d.toISOString().split('T')[0];
  }

  _getDateStr(date) {
    return date.toISOString().split('T')[0];
  }

  _parseTime(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    const now = new Date();
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    return d;
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
    let results;

    switch (game.source) {
      case 'lottoactivo':
        results = await fetchLottoActivo(game.id, today);
        break;
      case 'guacharito':
        results = await fetchGuacharito(today);
        break;
      case 'lagranjita':
        results = await fetchLaGranjita(this.loteriaEmail, this.loteriaPassword, today.replace(/-/g, ''));
        break;
      default:
        return null;
    }

    return results;
  }

  _extractLottoActivoResult(data, gameId, time) {
    if (!data || data.length === 0) return null;
    for (const juego of data) {
      if (!juego.resultados) continue;
      for (const s of juego.resultados) {
        if (!s.time_s) continue;
        const sHora = s.time_s.split(' ')[0];
        const [sH, sM] = sHora.split(':').map(Number);
        const [tH, tM] = time.split(':').map(Number);
        if (sH === tH && sM === tM) {
          return {
            number: s.number_animal,
            animal: s.name_animal,
            color: s.color_animal,
            time: s.time_s,
            raw: s
          };
        }
      }
    }
    return null;
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

  start() {
    this.tick();
    this.intervalId = setInterval(() => this.tick(), RETRY_INTERVAL_MS);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
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
