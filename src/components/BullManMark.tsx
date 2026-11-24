export function BullManMark({ className = 'w-9 h-9' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Bull Man Emblem"
    >
      <rect width="64" height="64" rx="14" className="fill-slate-900 dark:fill-[#111928]" />
      <rect x="1.5" y="1.5" width="61" height="61" rx="12.5" stroke="url(#bullGold)" strokeWidth="1.5" />
      <path
        d="M14 18C14 14 18 11 22 12C19 15 19 20 23 23L32 25L41 23C45 20 45 15 42 12C46 11 50 14 50 18C50 25 44 29 41 31L44 37L38 48L32 52L26 48L20 37L23 31C20 29 14 25 14 18Z"
        stroke="url(#bullGold)"
        strokeWidth="2.4"
        strokeLinejoin="round"
        fill="url(#bullFill)"
      />
      <path d="M25 34L29 36M39 34L35 36" stroke="#3B82F6" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="32" cy="45" r="2.2" stroke="url(#bullGold)" strokeWidth="1.8" />
      <defs>
        <linearGradient id="bullGold" x1="12" y1="10" x2="52" y2="54" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FBBF24" />
          <stop offset="1" stopColor="#D97706" />
        </linearGradient>
        <linearGradient id="bullFill" x1="32" y1="14" x2="32" y2="52" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F59E0B" stopOpacity="0.18" />
          <stop offset="1" stopColor="#1E3A8A" stopOpacity="0.25" />
        </linearGradient>
      </defs>
    </svg>
  );
}
