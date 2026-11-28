// filters.js — פילטרים לייצוב מעקב בזמן אמת.
// OneEuroFilter: הפילטר הסטנדרטי למעקב תנועה (Casiez et al. 2012) —
// מחליק רעד כשהתנועה איטית ונצמד למהירות כשהתנועה מהירה.

export class LowPass {
  constructor() { this.y = null; }
  filter(x, alpha) {
    if (this.y === null) this.y = x;
    this.y = alpha * x + (1 - alpha) * this.y;
    return this.y;
  }
}

export class OneEuroFilter {
  /**
   * @param {number} minCutoff תדר חיתוך מינימלי (נמוך = חלק יותר במנוחה)
   * @param {number} beta רגישות למהירות (גבוה = פחות פיגור בתנועה מהירה)
   */
  constructor({ minCutoff = 1.0, beta = 0.015, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = new LowPass();
    this.dx = new LowPass();
    this.lastT = null;
    this.lastX = null;
  }

  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x, tSec) {
    if (this.lastT === null) {
      this.lastT = tSec; this.lastX = x;
      this.x.filter(x, 1); this.dx.filter(0, 1);
      return x;
    }
    const dt = Math.max(1e-4, tSec - this.lastT);
    const dxRaw = (x - this.lastX) / dt;
    const dxHat = this.dx.filter(dxRaw, OneEuroFilter.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const out = this.x.filter(x, OneEuroFilter.alpha(cutoff, dt));
    this.lastT = tSec; this.lastX = x;
    return out;
  }
}

/** בנק פילטרים לנקודות ציון: מפתח → שלושה פילטרים (x,y,z). */
export class LandmarkFilterBank {
  constructor(opts) { this.opts = opts; this.map = new Map(); }
  filter(key, x, y, z, tSec) {
    let f = this.map.get(key);
    if (!f) {
      f = [new OneEuroFilter(this.opts), new OneEuroFilter(this.opts), new OneEuroFilter(this.opts)];
      this.map.set(key, f);
    }
    return { x: f[0].filter(x, tSec), y: f[1].filter(y, tSec), z: f[2].filter(z, tSec) };
  }
}
