import { clsx } from 'clsx';

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={clsx('animate-spin', className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function PageLoader({ label }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center gap-3 text-muted" role="status" aria-live="polite">
      <Spinner size={18} />
      {label && <span className="text-[13px]">{label}</span>}
    </div>
  );
}
