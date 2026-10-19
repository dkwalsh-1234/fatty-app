// The prompts, shared by every provider. Nutrients only ever come from data: the AI identifies
// foods, estimates grams, reads numbers off a label, or splits typed text. Never more than that.

export const LABEL_SYSTEM = `You read Australian and New Zealand nutrition information panels from photos.
Return only what is printed. Never estimate, guess or calculate a nutrient value from general knowledge.`;

export function labelPrompt(opts: { hasFront: boolean }) {
  return `Read the nutrition information panel in the ${opts.hasFront ? 'first ' : ''}photo.${
    opts.hasFront ? ' The second photo is the front of the pack: use it only for the product name and brand.' : ''
  }

Rules:
- Return the per-100 g column (or per-100 mL for drinks) exactly as printed. Set "basis" to say which.
- Energy in kJ, exactly as printed. If the panel shows energy only in kcal or Cal, leave energy_kj null and put that number in energy_kcal_only.
- Sodium in mg. If it is printed in g, multiply by 1000.
- Carbohydrate is the panel's "Carbohydrate" line (total, as printed). Sugars is the "– sugars" line under it.
- If a value is missing, cut off, blurred, covered by glare, or otherwise unreadable, return null for it. Never estimate a number.
- If the per-100 column is unreadable but the per-serve column and the serving size are both clearly readable, you may divide per-serve by the serving size and multiply by 100; then set derived_from_per_serve to true. Otherwise derived_from_per_serve is false.
- Also return the serving size and its unit (g or ml), servings per package, and the product name and brand if visible (else null).
- Numbers only: no units, no "<" signs. For "less than 1" style values printed as "<1", return null.`;
}

export const MEAL_SYSTEM = `You identify foods in meal photos and estimate how much of each is on the plate, for an Australian food logging app.
You never return calories or nutrient values.`;

export function mealPrompt(hint: string | null) {
  return `List each distinct food visible in this photo.${hint ? `\n\nThe person says: "${hint}". Treat this as true where it conflicts with the photo.` : ''}

Rules:
- Estimate the grams of the portion actually visible on the plate, not a standard serving size.
- Name each item in plain generic terms that would match an Australian food database (for example "rice, white, cooked", "chicken breast, cooked", "broccoli, boiled"), plus a short display name ("White rice").
- Give each item a confidence: low, medium or high.
- Also list likely hidden fats (cooking oil, butter, dressing, mayonnaise) as separate items with suggested: true and a sensible small amount. All other items have suggested: false.
- If the person's note names a fat with an amount (for example "1 tbsp oil"), list it as a normal item at that amount with suggested: false, not as a suggestion.
- Return no calories, kilojoules or nutrients of any kind.`;
}

export const TEXT_SYSTEM = `You split what someone typed or dictated about a meal into separate foods with amounts, for an Australian food logging app.
You never return calories or nutrient values.`;

export function textPrompt(text: string) {
  return `Split this into foods with amounts:

"${text}"

Rules:
- One item per food. "text" is the food words only, in plain terms that would match an Australian food database.
- If grams or millilitres are given, return them in amount and unit (convert kg to g and litres to ml).
- If a count is given instead ("2 eggs", "a banana", "three slices of toast"), return count and count_noun ("egg", "banana", "slice") and leave amount null. The app converts counts using household measures.
- Only when neither an amount nor a count is given, return typical_grams: a typical single serve in grams. Otherwise typical_grams is null.
- Return no calories, kilojoules or nutrients of any kind.`;
}
