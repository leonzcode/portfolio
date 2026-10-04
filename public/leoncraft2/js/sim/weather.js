export class Weather {
  constructor(sim) { this.sim = sim; this.rain = 0; this.thunder = 0; }
  tick() {}
  precipitation() {}
  rainingAt() { return false; }
  dispose() {}
  toJSON() { return {}; }
  fromJSON() {}
}
