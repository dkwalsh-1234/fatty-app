// FSANZ publishes two databases that list many of the same foods under identical names: AUSNUT, the
// survey database, with household measures ("Egg, chicken, whole, raw": 1 egg = 51 g), and AFCD,
// the composition database, with none. Each AFCD food whose name matches an AUSNUT food (ignoring
// case and punctuation) is marked superseded by it, so search shows the food once, with its
// measures, and anything already logged from the AFCD row keeps working.

/** "Egg, chicken, whole, raw" and "egg chicken whole raw" are the same name. */
export const sameNameKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function afcdDuplicates(ausnut: { id: string; name: string }[], afcd: { id: string; name: string }[]): { afcdId: string; ausnutId: string }[] {
  const byName = new Map<string, string>();
  for (const f of [...ausnut].sort((a, b) => a.id.localeCompare(b.id))) {
    const key = sameNameKey(f.name);
    if (!byName.has(key)) byName.set(key, f.id);
  }
  return afcd.flatMap((f) => {
    const ausnutId = byName.get(sameNameKey(f.name));
    return ausnutId ? [{ afcdId: f.id, ausnutId }] : [];
  });
}
