import { connectorIcon } from "@/lib/connector-catalog";

type Props = {
  provider: string;
  size?: number;
  className?: string;
  strokeWidth?: number;
};

function GmailMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden
    >
      <path
        fill="#EA4335"
        d="M3 6.75 12 13l9-6.25V18a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18V6.75Z"
      />
      <path fill="#FBBC05" d="M3 6.75V18l6-4.5V9.3L3 6.75Z" opacity=".9" />
      <path fill="#34A853" d="M21 6.75V18l-6-4.5V9.3l6-2.55Z" opacity=".9" />
      <path fill="#4285F4" d="M3 6.75 12 13l9-6.25-1.7-1.2L12 10.2 4.7 5.55 3 6.75Z" />
    </svg>
  );
}

function OutlookMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden
    >
      <rect x="2" y="3.5" width="13.5" height="17" rx="2.2" fill="#0A66C2" />
      <circle cx="8.75" cy="12" r="3.55" fill="none" stroke="#fff" strokeWidth="1.85" />
      <path
        fill="#28A8EA"
        d="M12.2 7.4H21a1.6 1.6 0 0 1 1.6 1.6v9.2A1.6 1.6 0 0 1 21 19.8h-8.6l-.2-1.25H20.7a.55.55 0 0 0 .55-.55V9.35a.55.55 0 0 0-.55-.55h-8.3L12.2 7.4Z"
      />
      <path
        fill="#fff"
        d="M13.85 10.15h5.9v1.05h-5.9v-1.05Zm0 2.2h5.9v1.05h-5.9v-1.05Zm0 2.2h4.1v1.05h-4.1v-1.05Z"
      />
    </svg>
  );
}

function WhoopMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden
    >
      <rect x="1.5" y="1.5" width="21" height="21" rx="5.5" fill="#0A0A0A" />
      <path
        fill="#fff"
        d="M5.2 7.1h2.15l1.55 6.35L11.2 7.1h1.6l2.3 6.35L16.65 7.1H18.8l-2.85 9.8h-2.05L11.6 10.4l-2.3 6.5H7.25L5.2 7.1Zm.55 10.35h12.5v1.45H5.75v-1.45Z"
      />
    </svg>
  );
}

function FitbitMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden
    >
      <rect x="1.5" y="1.5" width="21" height="21" rx="5.5" fill="#00B0B9" />
      <circle cx="7.2" cy="12" r="1.55" fill="#fff" />
      <circle cx="12" cy="8.6" r="1.55" fill="#fff" />
      <circle cx="12" cy="15.4" r="1.55" fill="#fff" />
      <circle cx="16.8" cy="12" r="1.55" fill="#fff" />
    </svg>
  );
}

function GoogleDriveMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden
    >
      <path fill="#4285F4" d="M8.1 3.5h7.8L22 14.2l-3.9 6.7H5.9L2 14.2 8.1 3.5Z" opacity=".15" />
      <path fill="#0066DA" d="m8.15 3.55 3.9 6.75H4.25L8.15 3.55Z" />
      <path fill="#00AC47" d="m15.85 3.55 3.9 6.75h-7.8l3.9-6.75Z" />
      <path fill="#FFBA00" d="M4.25 10.3h7.8L8.15 17.05 4.25 10.3Z" />
      <path fill="#00832D" d="m15.85 17.05-3.9-6.75h7.8l-3.9 6.75Z" />
      <path fill="#2684FC" d="M8.15 17.05h7.7l-3.85 6.65-3.85-6.65Z" />
    </svg>
  );
}

function GoogleCalendarMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="17" rx="2.5" fill="#fff" stroke="#1A73E8" strokeWidth="1.4" />
      <path fill="#1A73E8" d="M3 4h18v4.2H3V4Z" />
      <rect x="6.2" y="2.4" width="1.7" height="3.2" rx=".6" fill="#1A73E8" />
      <rect x="16.1" y="2.4" width="1.7" height="3.2" rx=".6" fill="#1A73E8" />
      <text
        x="12"
        y="16.4"
        textAnchor="middle"
        fill="#1A73E8"
        fontSize="8.5"
        fontFamily="system-ui,sans-serif"
        fontWeight="700"
      >
        31
      </text>
    </svg>
  );
}

function FigmaMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden
    >
      <path fill="#F24E1E" d="M8 2.5h4a3.5 3.5 0 0 1 0 7H8V2.5Z" />
      <path fill="#FF7262" d="M12 2.5h4a3.5 3.5 0 1 1 0 7h-4V2.5Z" />
      <path fill="#A259FF" d="M8 9.5h4a3.5 3.5 0 1 1 0 7H8V9.5Z" />
      <path fill="#1ABCFE" d="M12 9.5h4a3.5 3.5 0 1 1-3.5 3.5V9.5Z" />
      <path fill="#0ACF83" d="M8 16.5h4a3.5 3.5 0 1 1-3.5-3.5v3.5Z" />
    </svg>
  );
}

/** Brand marks for connectors — known brands use logos; others use Lucide. */
export function ConnectorBrandIcon({
  provider,
  size = 20,
  className,
  strokeWidth = 1.7,
}: Props) {
  const key = provider.trim().toLowerCase();
  if (key === "gmail") return <GmailMark size={size} className={className} />;
  if (key === "outlook") return <OutlookMark size={size} className={className} />;
  if (key === "whoop") return <WhoopMark size={size} className={className} />;
  if (key === "fitbit") return <FitbitMark size={size} className={className} />;
  if (key === "google_drive") return <GoogleDriveMark size={size} className={className} />;
  if (key === "google_calendar") return <GoogleCalendarMark size={size} className={className} />;
  if (key === "figma") return <FigmaMark size={size} className={className} />;

  const Icon = connectorIcon(key);
  return <Icon className={className} size={size} strokeWidth={strokeWidth} />;
}
