'use client';

import { useEffect, useState } from 'react';
import { searchFoods, type SearchResult } from './data';

/**
 * Debounced type-ahead over our own database (never Open Food Facts' search). Results land
 * within about 150 ms of the last keystroke; the previous results stay up while new ones load.
 */
export function useFoodSearch(query: string, limit = 30, enabled = true) {
  const text = query.trim();
  const active = enabled && text.length >= 2;
  const [done, setDone] = useState<{ q: string; results: SearchResult[]; error: string | null }>({ q: '', results: [], error: null });

  useEffect(() => {
    if (!active) return;
    let live = true;
    const t = setTimeout(() => {
      searchFoods(text, limit)
        .then((results) => live && setDone({ q: text, results, error: null }))
        .catch((e: Error) => live && setDone({ q: text, results: [], error: e.message }));
    }, 110);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [active, text, limit]);

  return {
    results: active && done.q ? done.results : null,
    searching: active && done.q !== text,
    error: active ? done.error : null,
  };
}
