'use client';

// Meals: your saved meals by most recent use, each with its total weight and per-100 g energy.
// Tap to log (amount sheet); edit and duplicate from the row; New meal in the dock.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useApp } from '@/components/app/AppProvider';
import { ActionSheet, Dock, DockButton, MoreDots, Notice, Screen, ScreenTitle, Spinner, TopBar } from '@/components/ui';
import { deleteFood, mealIngredients, myMeals, saveMeal, type ListedFood } from '@/lib/data';
import { energyText, int } from '@/lib/format';

export default function MealsPage() {
  const app = useApp();
  const router = useRouter();
  const [meals, setMeals] = useState<ListedFood[] | null>(null);
  const [menu, setMenu] = useState<ListedFood | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => myMeals().then(setMeals).catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);

  async function duplicate(m: ListedFood) {
    try {
      const ings = await mealIngredients(m.food.id);
      const copy = await saveMeal({
        name: `${m.food.display_name ?? m.food.name} (copy)`,
        serves: m.food.serves,
        cooked_weight_g: m.food.cooked_weight_g,
        ingredients: ings.map((i) => ({ food_id: i.ingredient_food_id, grams: i.grams })),
      });
      router.push(`/meals/${copy.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't duplicate.");
    }
  }

  async function remove(m: ListedFood) {
    try {
      await deleteFood(m.food.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete.");
    }
  }

  return (
    <Screen>
      <TopBar back="/" />
      <ScreenTitle sub="A meal is a recipe: ingredients with grams. Log it like any food: tap, type the grams eaten, Save.">Meals</ScreenTitle>
      <Notice tone="warn">{error}</Notice>
      {!meals ? (
        <div className="mt-10 flex justify-center">
          <Spinner />
        </div>
      ) : meals.length === 0 ? (
        <p className="mx-1 text-[15px] text-ink2">No meals yet. Make one from a recipe, or from anything you&apos;ve logged with “Save these as a meal”.</p>
      ) : (
        <section className="rounded-log-card bg-surface pl-5 pr-1.5 shadow-[var(--cc-card-shadow)]">
          {meals.map((m) => (
            <div key={m.food.id} className="flex min-h-[56px] items-center gap-2 border-t border-separator first:border-t-0">
              <button
                type="button"
                onClick={() => app.openAmount({ kind: 'food', foodId: m.food.id, food: m.food, method: 'meal' })}
                className="min-w-0 flex-1 border-0 bg-transparent py-2 text-left"
              >
                <span className="block truncate text-[15px]">{m.food.display_name ?? m.food.name}</span>
                <span className="block text-[13px] text-ink2 tnum">
                  {m.food.total_weight_g ? `${int(m.food.total_weight_g)} g` : 'No ingredients yet'}
                  {m.food.energy_kj != null && ` · ${energyText(m.food.energy_kj, app.profile.energy_unit)} per 100 g`}
                  {m.food.missing_nutrients.length > 0 && ' · incomplete'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setMenu(m)}
                aria-label={`${m.food.display_name ?? m.food.name} options: Edit, Duplicate`}
                className="flex h-11 w-11 items-center justify-center border-0 bg-transparent p-0 text-ink2"
              >
                <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-raised">
                  <MoreDots />
                </span>
              </button>
            </div>
          ))}
        </section>
      )}
      <p className="mx-1 mt-4 text-[13px] text-ink2">
        Meals also appear at the top of <Link href="/log/search" className="font-semibold text-accent">Search</Link>.
      </p>
      <ActionSheet
        open={!!menu}
        onClose={() => setMenu(null)}
        title={menu?.food.display_name ?? ''}
        actions={
          menu
            ? [
                { label: 'Edit', onClick: () => router.push(`/meals/${menu.food.id}`) },
                { label: 'Duplicate', onClick: () => duplicate(menu) },
                { label: 'Delete', tone: 'warn', hint: 'Past log entries keep their numbers.', onClick: () => remove(menu) },
              ]
            : []
        }
      />
      <Dock>
        <DockButton primary onClick={() => router.push('/meals/new')}>
          New meal
        </DockButton>
      </Dock>
    </Screen>
  );
}
