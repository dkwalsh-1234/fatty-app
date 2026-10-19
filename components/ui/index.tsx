'use client';

// Building blocks for the "Halo" direction. Everything is a capsule; one primary action per screen.
// Colours come from the design tokens (tokens.css), so light and dark both work.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, MoreDots, type IconName } from './Icon';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// Buttons ---------------------------------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'dockPrimary' | 'dockSecondary' | 'link' | 'warnLink' | 'quiet';

const VARIANT: Record<Variant, string> = {
  // On cream: pine fill, lime label (light); lime fill, pine label (dark).
  primary: 'bg-primary text-on-primary disabled:bg-raised disabled:text-ink3',
  secondary: 'bg-raised text-ink disabled:text-ink3',
  // Inside the dock, or anywhere on pine.
  dockPrimary: 'bg-pine-lime text-pine-on-lime disabled:bg-pine-raised disabled:text-pine-mint3',
  dockSecondary: 'bg-pine-raised text-pine-mint disabled:text-pine-mint3',
  link: 'bg-transparent text-accent font-semibold',
  warnLink: 'bg-transparent text-warn-text font-semibold',
  quiet: 'bg-transparent text-ink2',
};

export function Button({
  variant = 'primary',
  size = 'lg',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'lg' | 'md' | 'sm' }) {
  const sizing =
    variant === 'link' || variant === 'warnLink' || variant === 'quiet'
      ? 'min-h-11 px-1 text-[15px]'
      : size === 'lg'
        ? 'h-[54px] rounded-[27px] px-6 text-[17px] font-semibold'
        : size === 'md'
          ? 'h-12 rounded-3xl px-5 text-base font-semibold'
          : 'h-10 rounded-[20px] px-4 text-[15px] font-semibold';
  return (
    <button type="button" className={cx('press inline-flex items-center justify-center gap-2 border-0', sizing, VARIANT[variant], className)} {...rest}>
      {children}
    </button>
  );
}

/** A 36 px round icon button in the raised tone (back, close). Touch target stays 44 px. */
export function RoundButton({ icon, label, onClick, href, tone = 'raised', size = 36 }: {
  icon: IconName;
  label: string;
  onClick?: () => void;
  href?: string;
  tone?: 'raised' | 'pine';
  size?: number;
}) {
  const inner = (
    <span
      className={cx('flex items-center justify-center rounded-full', tone === 'pine' ? 'bg-pine-raised text-pine-mint' : 'bg-raised text-ink2')}
      style={{ width: size, height: size }}
    >
      <Icon name={icon} size={size <= 32 ? 14 : 18} stroke={icon === 'close' ? 2.6 : 2.2} />
    </span>
  );
  const cls = 'press flex h-11 w-11 shrink-0 items-center justify-center border-0 bg-transparent p-0';
  return href ? (
    <Link href={href} aria-label={label} className={cls}>
      {inner}
    </Link>
  ) : (
    <button type="button" aria-label={label} onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

export function BackButton({ href, label = 'Back' }: { href?: string; label?: string }) {
  const router = useRouter();
  return (
    <RoundButton
      icon="back"
      label={label}
      onClick={href ? undefined : () => (window.history.length > 1 ? router.back() : router.push('/'))}
      href={href}
    />
  );
}

// Layout ----------------------------------------------------------------------------------------

/** A screen on the sage (light) or pine (dark) page, phone width, with room for the dock. */
export function Screen({ children, dock = true, className }: { children: ReactNode; dock?: boolean; className?: string }) {
  return (
    <main className={cx('mx-auto w-full max-w-[480px] px-4', dock ? 'pb-dock' : 'pb-10', className)}>{children}</main>
  );
}

/** Back button, centred title, optional right action. As on meal confirm and label review. */
export function TopBar({ title, back, right }: { title?: ReactNode; back?: string | true; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 -mx-4 mb-2 flex h-[60px] items-center justify-between bg-bg/90 px-2 backdrop-blur-md">
      <div className="w-[88px]">{back && <BackButton href={back === true ? undefined : back} />}</div>
      <h1 className="truncate text-center text-[18px] font-semibold">{title}</h1>
      <div className="flex w-[88px] justify-end">{right}</div>
    </header>
  );
}

export function ScreenTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-4 mt-2 px-1">
      <h1 className="text-[30px] font-semibold leading-[1.15] tracking-[-0.025em]">{children}</h1>
      {sub && <p className="mt-1.5 text-[15px] leading-[1.45] text-ink2">{sub}</p>}
    </div>
  );
}

export function Card({ children, className, as: As = 'section', ...rest }: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div';
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <As className={cx('rounded-card bg-surface px-5 py-[18px] shadow-[var(--cc-card-shadow)]', className)} {...rest}>
      {children}
    </As>
  );
}

/** Caps section label: 12 / 600, +8% tracking, ink 2. */
export function CapsLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cx('caps mx-1 mb-2 mt-5 text-ink2', className)}>{children}</h2>;
}

/** Card header row: headline on the left, a count or action on the right, then a separator. */
export function CardHeader({ title, right }: { title: ReactNode; right?: ReactNode }) {
  return (
    <div className="-mx-5 mb-0 flex min-h-12 items-center justify-between border-b border-separator px-5 pb-3">
      <span className="text-[17px] font-semibold">{title}</span>
      {right != null && <span className="text-[15px] text-ink2 tnum">{right}</span>}
    </div>
  );
}

/** A 48 px settings-style row with value in ink 2 and a chevron. */
export function Row({ label, value, href, onClick, children, sub }: {
  label: ReactNode;
  value?: ReactNode;
  href?: string;
  onClick?: () => void;
  children?: ReactNode;
  sub?: ReactNode;
}) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-base">{label}</span>
        {sub && <span className="block text-[13px] leading-snug text-ink2">{sub}</span>}
      </span>
      {value != null && <span className="text-right text-[15px] text-ink2 tnum">{value}</span>}
      {children}
      {(href || onClick) && <Icon name="chevronRight" size={18} className="text-ink3" />}
    </>
  );
  const cls = 'flex min-h-12 w-full items-center gap-3 border-0 border-t border-separator bg-transparent py-2.5 text-left first:border-t-0';
  if (href) return <Link href={href} className={cls}>{body}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={cls}>{body}</button>;
  return <div className={cls}>{body}</div>;
}

// Inputs ----------------------------------------------------------------------------------------

export function Chip({ selected, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cx(
        'press h-[38px] shrink-0 whitespace-nowrap rounded-[19px] border-0 px-4 text-sm tnum',
        selected ? 'bg-primary font-semibold text-on-primary' : 'bg-raised font-medium text-ink',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** A 48 px capsule field with an optional unit and label above it. */
export function Field({ label, unit, hint, error, className, inputClassName, id, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & {
  label?: ReactNode;
  unit?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  inputClassName?: string;
}) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <label htmlFor={fid} className={cx('block min-w-0', className)}>
      {label && <span className="mb-1.5 block text-[15px] text-ink2">{label}</span>}
      <span className="flex h-12 min-w-0 items-center rounded-[24px] bg-raised px-5 focus-within:shadow-[0_0_0_2.5px_var(--cc-focus),0_0_0_8px_var(--cc-focus-glow)]">
        <input
          id={fid}
          className={cx('h-full w-full min-w-0 flex-1 border-0 bg-transparent text-[17px] outline-none tnum', inputClassName)}
          {...rest}
        />
        {unit && <span className="pl-2 text-[15px] text-ink2">{unit}</span>}
      </span>
      {hint && !error && <span className="mt-1.5 block px-1 text-[13px] leading-snug text-ink2">{hint}</span>}
      {error && <span className="mt-1.5 block px-1 text-[13px] leading-snug text-warn-text">{error}</span>}
    </label>
  );
}

export function Select({ label, children, className, id, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: ReactNode }) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <label htmlFor={fid} className={cx('block min-w-0', className)}>
      {label && <span className="mb-1.5 block text-[15px] text-ink2">{label}</span>}
      <span className="relative flex h-12 min-w-0 items-center rounded-[24px] bg-raised px-5 focus-within:shadow-[0_0_0_2.5px_var(--cc-focus),0_0_0_8px_var(--cc-focus-glow)]">
        <select id={fid} className="h-full min-w-0 flex-1 appearance-none border-0 bg-transparent pr-6 text-[17px] outline-none" {...rest}>
          {children}
        </select>
        <Icon name="chevronDown" size={16} stroke={2.2} className="pointer-events-none absolute right-5 text-ink2" />
      </span>
    </label>
  );
}

/** Two or three options, as on the meal editor's Sum / Cooked control. */
export function Segmented<T extends string>({ value, onChange, options, label, tone = 'cream' }: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  label: string;
  tone?: 'cream' | 'glass';
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx('flex rounded-[26px] p-1', tone === 'glass' ? 'cc-dock' : 'bg-raised')}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cx(
              'press min-h-11 flex-1 rounded-[22px] border-0 px-3 text-[15px] font-semibold',
              tone === 'glass'
                ? on ? 'bg-pine-lime text-pine-on-lime' : 'bg-transparent text-pine-mint'
                : on ? 'bg-primary text-on-primary' : 'bg-transparent text-ink2',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx('relative h-[30px] w-[50px] shrink-0 rounded-full border-0 transition-colors', checked ? 'bg-accent' : 'bg-raised')}
    >
      <span
        className={cx(
          'absolute top-[3px] h-6 w-6 rounded-full shadow-sm transition-[left]',
          checked ? 'left-[23px] bg-surface' : 'left-[3px] bg-ink3',
        )}
      />
    </button>
  );
}

// Dock ------------------------------------------------------------------------------------------

/** The glass dock, 16 px above the bottom edge. Content scrolls under it. */
export function Dock({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('cc-dock cc-dock-fixed flex gap-1.5', className)}>{children}</div>;
}

/** Dock buttons: 52 px capsules, concentric with the dock (radius 34 − 6 padding = 28). */
export function DockButton({ primary, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return (
    <button
      type="button"
      className={cx(
        'press h-[52px] min-w-0 flex-1 rounded-[28px] border-0 px-4 text-base font-semibold',
        primary
          ? 'bg-pine-lime text-pine-on-lime disabled:bg-pine-raised disabled:text-pine-mint3'
          : 'bg-pine-raised text-pine-mint disabled:text-pine-mint3',
        className,
      )}
      {...rest}
    />
  );
}

// Sheets ----------------------------------------------------------------------------------------

export function Sheet({ open, onClose, children, label, className }: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="cc-scrim absolute inset-0 bg-scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cx(
          'cc-sheet absolute inset-x-0 bottom-0 mx-auto flex max-h-[calc(100dvh-24px)] max-w-[480px] flex-col overflow-y-auto rounded-t-[32px] bg-surface px-4 pb-[max(16px,env(safe-area-inset-bottom))]',
          className,
        )}
      >
        <div className="flex justify-center pb-1 pt-2">
          <div className="h-[5px] w-9 rounded-[3px] bg-ink3" />
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** A small list of actions in a sheet (the ⋯ menus). */
export function ActionSheet({ open, onClose, title, actions }: {
  open: boolean;
  onClose: () => void;
  title: string;
  actions: { label: string; onClick: () => void; tone?: 'warn'; hint?: string; disabled?: boolean }[];
}) {
  return (
    <Sheet open={open} onClose={onClose} label={title}>
      <p className="px-2 pb-2 pt-1 text-center text-[15px] font-semibold text-ink2">{title}</p>
      <div className="flex flex-col pb-2">
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            disabled={a.disabled}
            onClick={() => {
              onClose();
              a.onClick();
            }}
            className={cx(
              'press min-h-[52px] rounded-3xl border-0 bg-transparent px-4 text-left text-[17px] disabled:text-ink3',
              a.tone === 'warn' ? 'text-warn-text' : 'text-ink',
            )}
          >
            {a.label}
            {a.hint && <span className="block text-[13px] text-ink2">{a.hint}</span>}
          </button>
        ))}
        <Button variant="secondary" className="mt-2" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Sheet>
  );
}

// Small text pieces -------------------------------------------------------------------------------

/** Dashed chip for missing data: "incomplete · 1", "sat fat –". */
export function DashedChip({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span title={title} className="shrink-0 whitespace-nowrap rounded-[9px] border-[1.5px] border-dashed border-ink3 px-[7px] text-[11px] font-semibold leading-[17px] text-ink2">
      {children}
    </span>
  );
}

export function MacroDot({ colour, size = 8 }: { colour: 'protein' | 'carbs' | 'fat' | 'other'; size?: number }) {
  return <span aria-hidden="true" className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: `var(--cc-${colour})` }} />;
}

/** Inline status or error line. Calm: ink 2, or the warning text colour for problems. */
export function Notice({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'warn'; className?: string }) {
  if (!children) return null;
  return (
    <p role={tone === 'warn' ? 'alert' : 'status'} className={cx('px-1 text-[14px] leading-snug', tone === 'warn' ? 'text-warn-text' : 'text-ink2', className)}>
      {children}
    </p>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" aria-label={label} className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-ink3 border-t-transparent" />
  );
}

export { Icon, MoreDots, cx };
