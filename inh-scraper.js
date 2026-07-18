export class INHScraper {
  constructor() {
    this.cache = { program: [], races: {}, lastPoll: null, isRunning: false };
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
