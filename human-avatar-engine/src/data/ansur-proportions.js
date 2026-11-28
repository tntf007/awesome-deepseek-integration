// ansur-proportions.js — נוצר אוטומטית על ידי tools/build-ansur-proportions.mjs
// מקור הנתונים: ANSUR II — the 2012 U.S. Army Anthropometric Survey
// (Gordon et al., Natick/TR-15/007; נתונים ציבוריים, 93 מדידות, 6,068 נבדקים).
// כל הערכים במילימטרים; mean / p5 / p50 / p95 לכל מדידה, לפי מין.
// אל תערכו ידנית — הריצו את המחולל מחדש.

export const ANSUR2 = {
  "male": {
    "stature": {
      "mean": 1756.2,
      "p5": 1648,
      "p50": 1755,
      "p95": 1870
    },
    "acromialheight": {
      "mean": 1440.7,
      "p5": 1339,
      "p50": 1439,
      "p95": 1546
    },
    "cervicaleheight": {
      "mean": 1517.3,
      "p5": 1416,
      "p50": 1517,
      "p95": 1623
    },
    "trochanterionheight": {
      "mean": 900.9,
      "p5": 824,
      "p50": 899,
      "p95": 985
    },
    "kneeheightmidpatella": {
      "mean": 488.4,
      "p5": 443,
      "p50": 487,
      "p95": 536
    },
    "lateralmalleolusheight": {
      "mean": 72.9,
      "p5": 64,
      "p50": 73,
      "p95": 83
    },
    "acromionradialelength": {
      "mean": 335.2,
      "p5": 307,
      "p50": 335,
      "p95": 365
    },
    "radialestylionlength": {
      "mean": 267.9,
      "p5": 244,
      "p50": 267,
      "p95": 295
    },
    "handlength": {
      "mean": 193.3,
      "p5": 177,
      "p50": 193,
      "p95": 210
    },
    "biacromialbreadth": {
      "mean": 415.7,
      "p5": 384,
      "p50": 415,
      "p95": 447
    },
    "hipbreadth": {
      "mean": 345.7,
      "p5": 308,
      "p50": 344,
      "p95": 387
    },
    "tragiontopofhead": {
      "mean": 131.1,
      "p5": 121,
      "p50": 131,
      "p95": 141
    },
    "footlength": {
      "mean": 271.2,
      "p5": 250,
      "p50": 271,
      "p95": 293
    },
    "buttockheight": {
      "mean": 887.9,
      "p5": 809,
      "p50": 885,
      "p95": 972
    },
    "weightkg": {
      "mean": 855.2,
      "p5": 644,
      "p50": 846,
      "p95": 1107
    },
    "n": 4082
  },
  "female": {
    "stature": {
      "mean": 1628.5,
      "p5": 1525,
      "p50": 1626,
      "p95": 1740
    },
    "acromialheight": {
      "mean": 1335.1,
      "p5": 1242,
      "p50": 1332,
      "p95": 1434
    },
    "cervicaleheight": {
      "mean": 1395.7,
      "p5": 1300,
      "p50": 1393,
      "p95": 1498
    },
    "trochanterionheight": {
      "mean": 845.4,
      "p5": 774,
      "p50": 844,
      "p95": 919
    },
    "kneeheightmidpatella": {
      "mean": 449,
      "p5": 408,
      "p50": 448,
      "p95": 493
    },
    "lateralmalleolusheight": {
      "mean": 62.7,
      "p5": 54,
      "p50": 63,
      "p95": 71
    },
    "acromionradialelength": {
      "mean": 311.2,
      "p5": 283,
      "p50": 311,
      "p95": 340
    },
    "radialestylionlength": {
      "mean": 241.3,
      "p5": 218,
      "p50": 241,
      "p95": 268
    },
    "handlength": {
      "mean": 181.1,
      "p5": 165,
      "p50": 180,
      "p95": 199
    },
    "biacromialbreadth": {
      "mean": 365.3,
      "p5": 335,
      "p50": 365,
      "p95": 396
    },
    "hipbreadth": {
      "mean": 353.8,
      "p5": 311,
      "p50": 353,
      "p95": 400
    },
    "tragiontopofhead": {
      "mean": 126.5,
      "p5": 116,
      "p50": 127,
      "p95": 137
    },
    "footlength": {
      "mean": 246.3,
      "p5": 226,
      "p50": 246,
      "p95": 268
    },
    "buttockheight": {
      "mean": 833.7,
      "p5": 761,
      "p50": 831,
      "p95": 911
    },
    "weightkg": {
      "mean": 677.6,
      "p5": 513,
      "p50": 668,
      "p95": 871
    },
    "n": 1986
  }
};

/** מחזיר אובייקט מדידות (מ"מ) לפי מין ואחוזון ('mean' | 'p5' | 'p50' | 'p95'). */
export function ansurMeasurements(sex = 'male', q = 'mean') {
  const src = ANSUR2[sex];
  const m = {};
  for (const [k, v] of Object.entries(src)) if (typeof v === 'object') m[k] = v[q];
  return m;
}
