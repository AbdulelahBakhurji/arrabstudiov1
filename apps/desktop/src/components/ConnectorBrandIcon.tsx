import type { ReactNode } from "react";
import { connectorIcon } from "@/lib/connector-catalog";

type Props = {
  provider: string;
  size?: number;
  className?: string;
  strokeWidth?: number;
};

type MarkProps = { size?: number; className?: string };

function Mark({
  size = 20,
  className,
  viewBox = "0 0 24 24",
  children,
}: MarkProps & { viewBox?: string; children: ReactNode }) {
  return (
    <svg viewBox={viewBox} width={size} height={size} className={className} aria-hidden>
      {children}
    </svg>
  );
}

function GmailMark(props: MarkProps) {
  return (
    <Mark {...props} viewBox="0 0 48 48">
      <path fill="#4caf50" d="M45 16.2l-5 2.75-5 4.75V40h7c1.657 0 3-1.343 3-3V16.2z" />
      <path fill="#1e88e5" d="M3 16.2l3.614 1.71L13 23.7V40H6c-1.657 0-3-1.343-3-3V16.2z" />
      <path fill="#e53935" d="M35 11.2 24 19.45 13 11.2 12 17l1 6.7 11 8.25 11-8.25L36 17z" />
      <path
        fill="#c62828"
        d="M3 12.298V16.2l10 7.5V11.2L9.876 8.859A4.298 4.298 0 0 0 7.298 8C4.924 8 3 9.924 3 12.298z"
      />
      <path
        fill="#fbc02d"
        d="M45 12.298V16.2l-10 7.5V11.2l3.124-2.341A4.298 4.298 0 0 1 40.702 8C43.076 8 45 9.924 45 12.298z"
      />
    </Mark>
  );
}

function OutlookMark(props: MarkProps) {
  return (
    <Mark {...props}>
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
    </Mark>
  );
}

function WhoopMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <rect x="1.5" y="1.5" width="21" height="21" rx="5.5" fill="#0A0A0A" />
      <path
        fill="#fff"
        d="M5.2 7.1h2.15l1.55 6.35L11.2 7.1h1.6l2.3 6.35L16.65 7.1H18.8l-2.85 9.8h-2.05L11.6 10.4l-2.3 6.5H7.25L5.2 7.1Zm.55 10.35h12.5v1.45H5.75v-1.45Z"
      />
    </Mark>
  );
}

function FitbitMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <rect x="1.5" y="1.5" width="21" height="21" rx="5.5" fill="#00B0B9" />
      <circle cx="7.2" cy="12" r="1.55" fill="#fff" />
      <circle cx="12" cy="8.6" r="1.55" fill="#fff" />
      <circle cx="12" cy="15.4" r="1.55" fill="#fff" />
      <circle cx="16.8" cy="12" r="1.55" fill="#fff" />
    </Mark>
  );
}

function GoogleDriveMark(props: MarkProps) {
  return (
    <Mark {...props} viewBox="0 0 87.3 78">
      <path fill="#0066da" d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" />
      <path fill="#00ac47" d="M43.65 25 29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44A9.06 9.06 0 0 0 0 53h27.5z" />
      <path
        fill="#ea4335"
        d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.798l5.852 11.5z"
      />
      <path fill="#00832d" d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" />
      <path fill="#2684fc" d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" />
      <path fill="#ffba00" d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" />
    </Mark>
  );
}

function GoogleCalendarMark(props: MarkProps) {
  return (
    <Mark {...props} viewBox="0 0 200 200">
      <path fill="#fff" d="M152.632 47.368H47.368v105.263h105.263z" />
      <path fill="#EA4335" d="M152.632 200 200 152.632h-47.368z" />
      <path fill="#FBBC04" d="M200 47.368h-47.368v105.263H200z" />
      <path fill="#34A853" d="M152.632 152.632H47.368V200h105.263z" />
      <path fill="#188038" d="M0 152.632v31.579C0 192.935 7.065 200 15.789 200h31.579v-47.368z" />
      <path fill="#1967D2" d="M200 47.368V15.789C200 7.065 192.935 0 184.211 0h-31.579v47.368z" />
      <path fill="#4285F4" d="M152.632 0H15.789C7.065 0 0 7.065 0 15.789v136.842h47.368V47.368h105.263z" />
      <path
        fill="#4285F4"
        d="M68.961 129.026c-3.934-2.658-6.658-6.539-8.145-11.671l9.132-3.763c.829 3.158 2.276 5.605 4.342 7.342 2.053 1.737 4.553 2.592 7.474 2.592 2.987 0 5.553-.908 7.697-2.724s3.224-4.132 3.224-6.934c0-2.868-1.132-5.211-3.395-7.026s-5.105-2.724-8.5-2.724h-5.276v-9.039h4.736c2.921 0 5.382-.789 7.382-2.368s3-3.737 3-6.487c0-2.447-.895-4.395-2.684-5.855s-4.053-2.197-6.803-2.197c-2.684 0-4.816.711-6.395 2.145s-2.724 3.197-3.447 5.276l-9.039-3.763c1.197-3.395 3.395-6.395 6.618-8.987s7.342-3.895 12.342-3.895c3.697 0 7.026.711 9.974 2.145 2.947 1.434 5.263 3.421 6.934 5.947 1.671 2.539 2.5 5.382 2.5 8.539 0 3.224-.776 5.947-2.329 8.184s-3.461 3.947-5.724 5.145v.539a17.379 17.379 0 0 1 7.342 5.724c1.908 2.566 2.868 5.632 2.868 9.211s-.908 6.776-2.724 9.579-4.329 5.013-7.513 6.618c-3.197 1.605-6.789 2.421-10.776 2.421-4.618.013-8.881-1.316-12.815-3.974zm56.093-45.315-10.026 7.25-5.013-7.605 17.987-12.974h6.895v61.197h-9.842z"
      />
    </Mark>
  );
}

function FigmaMark(props: MarkProps) {
  return (
    <Mark {...props} viewBox="-9.5 0 57 57">
      <path fill="#1abcfe" d="M19 28.5a9.5 9.5 0 1 1 19 0 9.5 9.5 0 0 1-19 0z" />
      <path fill="#0acf83" d="M0 47.5A9.5 9.5 0 0 1 9.5 38H19v9.5a9.5 9.5 0 1 1-19 0z" />
      <path fill="#ff7262" d="M19 0v19h9.5a9.5 9.5 0 1 0 0-19H19z" />
      <path fill="#f24e1e" d="M0 9.5A9.5 9.5 0 0 0 9.5 19H19V0H9.5A9.5 9.5 0 0 0 0 9.5z" />
      <path fill="#a259ff" d="M0 28.5A9.5 9.5 0 0 0 9.5 38H19V19H9.5A9.5 9.5 0 0 0 0 28.5z" />
    </Mark>
  );
}

function SlackMark(props: MarkProps) {
  return (
    <Mark {...props} viewBox="0 0 122.8 122.8">
      <path
        fill="#e01e5a"
        d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z"
      />
      <path
        fill="#36c5f0"
        d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z"
      />
      <path
        fill="#2eb67d"
        d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z"
      />
      <path
        fill="#ecb22e"
        d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z"
      />
    </Mark>
  );
}

/* Monochrome brands follow the surrounding text colour so they read on both themes. */
function GithubMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <path
        fill="currentColor"
        d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
      />
    </Mark>
  );
}

function NotionMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <path
        fill="currentColor"
        d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z"
      />
    </Mark>
  );
}

function LinearMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <path
        fill="#5E6AD2"
        d="M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z"
      />
    </Mark>
  );
}

function GitlabMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <path
        fill="#FC6D26"
        d="m23.6004 9.5927-.0337-.0862L20.3.9814a.851.851 0 0 0-.3362-.405.8748.8748 0 0 0-.9997.0539.8748.8748 0 0 0-.29.4399l-2.2055 6.748H7.5375l-2.2057-6.748a.8573.8573 0 0 0-.29-.4412.8748.8748 0 0 0-.9997-.0537.8585.8585 0 0 0-.3362.4049L.4332 9.5015l-.0325.0862a6.0657 6.0657 0 0 0 2.0119 7.0105l.0113.0087.03.0213 4.976 3.7264 2.462 1.8633 1.4995 1.1321a1.0085 1.0085 0 0 0 1.2197 0l1.4995-1.1321 2.4619-1.8633 5.006-3.7489.0125-.01a6.0682 6.0682 0 0 0 2.0094-7.003z"
      />
    </Mark>
  );
}

function BitbucketMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <path
        fill="#2684FF"
        d="M.778 1.213a.768.768 0 0 0-.768.892l3.263 19.81c.084.5.515.868 1.022.873H19.95a.772.772 0 0 0 .77-.646l3.27-20.03a.768.768 0 0 0-.768-.891zM14.52 15.53H9.522L8.17 8.466h7.561z"
      />
    </Mark>
  );
}

function WhatsappMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <path
        fill="#25D366"
        d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"
      />
    </Mark>
  );
}

function EmailMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <rect x="1.5" y="1.5" width="21" height="21" rx="5.5" fill="#1C7CF4" />
      <rect x="5.5" y="7.5" width="13" height="9.5" rx="1.6" fill="none" stroke="#fff" strokeWidth="1.6" />
      <path d="m6 8.4 6 4.6 6-4.6" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
    </Mark>
  );
}

function SshMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <rect x="1.5" y="1.5" width="21" height="21" rx="5.5" fill="#15151B" stroke="#3A3A46" />
      <path d="m6.5 8.5 3.5 3.5-3.5 3.5" fill="none" stroke="#3DDC84" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 15.8h5.5" stroke="#E6E6EA" strokeWidth="1.9" strokeLinecap="round" />
    </Mark>
  );
}

function FinnhubMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <rect x="1.5" y="1.5" width="21" height="21" rx="5.5" fill="#0E1A2B" />
      <path d="M5.5 16.5 9.5 12l3 2.6 6-7" fill="none" stroke="#22C55E" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="18.5" cy="7.6" r="1.5" fill="#22C55E" />
    </Mark>
  );
}

const BRAND_MARKS: Record<string, (props: MarkProps) => ReactNode> = {
  gmail: GmailMark,
  outlook: OutlookMark,
  email: EmailMark,
  whoop: WhoopMark,
  fitbit: FitbitMark,
  google_drive: GoogleDriveMark,
  google_calendar: GoogleCalendarMark,
  figma: FigmaMark,
  slack: SlackMark,
  github: GithubMark,
  notion: NotionMark,
  linear: LinearMark,
  gitlab: GitlabMark,
  bitbucket: BitbucketMark,
  whatsapp: WhatsappMark,
  ssh: SshMark,
  finnhub: FinnhubMark,
};

/** Brand marks for connectors — known brands use logos; others use Lucide. */
export function ConnectorBrandIcon({
  provider,
  size = 20,
  className,
  strokeWidth = 1.7,
}: Props) {
  const key = provider.trim().toLowerCase();
  const BrandMark = BRAND_MARKS[key];
  if (BrandMark) return <BrandMark size={size} className={className} />;

  const Icon = connectorIcon(key);
  return <Icon className={className} size={size} strokeWidth={strokeWidth} />;
}
