export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md px-4 py-10 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-navy-900">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-graphite-500">{subtitle}</p>}
      <div className="card mt-6 p-5 sm:p-6">{children}</div>
    </div>
  );
}
