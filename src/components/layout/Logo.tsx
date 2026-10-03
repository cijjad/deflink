export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
        <rect width="32" height="32" rx="7" fill="#2f6bea" />
        <path d="M9 9h7a7 7 0 0 1 0 14H9z" fill="none" stroke="#fff" strokeWidth="2.6" />
        <circle cx="16" cy="16" r="2.2" fill="#fff" />
      </svg>
      <span className="text-[17px]">DefLink</span>
    </span>
  );
}
