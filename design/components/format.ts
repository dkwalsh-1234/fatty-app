// Number formatting used across the designs. Australian English, tabular figures in CSS.

const nf0 = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-AU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** 1460 -> "1,460". Energy, sodium and grams of whole foods. */
export const int = (n: number) => nf0.format(Math.round(n));

/** 6.4 -> "6.4". Nutrient grams in rows and targets. */
export const one = (n: number) => nf1.format(Math.round(n * 10) / 10);

/** Grams as shown on target rows: 112, 6.4, 38, 0.6. Whole numbers drop the decimal; 100 and up are whole. */
export const grams = (n: number) => {
  const r = Math.round(n * 10) / 10;
  return Math.abs(r) >= 100 || Number.isInteger(r) ? int(r) : one(r);
};

/** Missing is not zero: null shows as an en dash. */
export const orDash = (n: number | null | undefined, f: (n: number) => string = one) => (n == null ? '–' : f(n));

/** Salt equivalent shown beside sodium: salt g = sodium mg x 2.5 / 1000. */
export const saltFromSodiumMg = (mg: number) => (mg * 2.5) / 1000;

/** "1,240 mg (3.1 g salt)" */
export const sodiumWithSalt = (mg: number | null) => (mg == null ? '– mg' : `${int(mg)} mg (${one(saltFromSodiumMg(mg))} g salt)`);

export const kjToKcal = (kj: number) => kj / 4.184;
export const kcalToKj = (kcal: number) => kcal * 4.184;

/** Targets are shown as round numbers (brief: be honest about precision). */
export const roundTarget = (kcal: number) => Math.round(kcal / 10) * 10;
