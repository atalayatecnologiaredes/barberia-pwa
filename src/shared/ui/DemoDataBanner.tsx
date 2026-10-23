export function DemoDataBanner({ active }: { active: boolean }) {
  if (!active || !import.meta.env.DEV) return null;
  return <div role="note" className="rounded-xl border border-amber-400/25 bg-amber-400/[.07] px-4 py-3 text-xs leading-5 text-amber-100">
    <strong className="font-semibold">Vista de demostración.</strong> Estos datos son ejemplos locales; no están guardados en Supabase y no se usan en producción.
  </div>;
}
