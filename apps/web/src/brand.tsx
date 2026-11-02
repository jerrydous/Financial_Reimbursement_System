export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#1F6B58" />
      <path d="M9.2 8.2h9.1L22.6 12.5V23.2c0 .6-.5 1.1-1.1 1.1H9.2c-.6 0-1.1-.5-1.1-1.1V9.3c0-.6.5-1.1 1.1-1.1z" fill="#F6F1E6" />
      <path d="M18.3 8.2v3.6c0 .4.3.7.7.7h3.6" fill="#E5D8C4" />
      <rect x="10.6" y="14.2" width="7.4" height="1.35" rx=".67" fill="#1F6B58" />
      <rect x="10.6" y="17.1" width="4.8" height="1.35" rx=".67" fill="#1F6B58" opacity=".45" />
      <circle cx="20.15" cy="20.35" r="3.55" fill="#C4513A" />
      <path d="M18.45 20.35 19.55 21.45 21.85 19.05" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
