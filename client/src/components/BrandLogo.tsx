import { cn } from "@/lib/utils";

/**
 * Brand mark: a calendar page with a heartbeat line running through it -- scheduling + care.
 * Uses currentColor so it inherits text color from wherever it's placed. Keep in sync with
 * client/public/favicon.svg.
 */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("h-7 w-7", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* Calendar body + header band */}
      <rect x="3" y="5" width="18" height="16" rx="3.5" />
      <path d="M3 8.5A3.5 3.5 0 0 1 6.5 5h11A3.5 3.5 0 0 1 21 8.5V10H3Z" fill="currentColor" fillOpacity="0.3" stroke="none" />
      {/* Binder rings */}
      <line x1="8" y1="3" x2="8" y2="7" />
      <line x1="16" y1="3" x2="16" y2="7" />
      {/* Heartbeat */}
      <polyline points="5.5 15.5 8.5 15.5 10 12.5 12.5 18.5 14.5 14 15.5 15.5 18.5 15.5" strokeWidth="2.2" />
    </svg>
  );
}
