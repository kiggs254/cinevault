/** One node in a vertical numbered setup stepper (circle + connecting line). */
export function SetupStep({
  n,
  last,
  title,
  children,
}: {
  n: number;
  last?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-4">
      <div className="flex flex-none flex-col items-center">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-sm font-bold text-[#1a1206]">
          {n}
        </span>
        {!last && <span className="mt-1 w-px flex-1 bg-border" />}
      </div>
      <div className="min-w-0 flex-1 pb-6">
        <p className="mb-2 font-semibold text-ink">{title}</p>
        {children}
      </div>
    </li>
  );
}
