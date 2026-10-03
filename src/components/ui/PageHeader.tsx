export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-graphite-500">{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="card px-6 py-10 text-center">
      <div className="font-semibold text-graphite-900">{title}</div>
      <p className="mx-auto mt-1 max-w-sm text-sm text-graphite-500">{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
