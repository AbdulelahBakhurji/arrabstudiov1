import { useState } from "react";
import { ConnectorBrandIcon } from "@/domains/connectors/ui/ConnectorBrandIcon";

/** Control-supplied logo when set and loadable; otherwise the built-in brand mark. */
export function ConnectorMark({
  provider,
  logoUrl,
  size = 20,
  className,
}: {
  provider: string;
  logoUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (logoUrl && failedUrl !== logoUrl) {
    return (
      <img
        src={logoUrl}
        alt=""
        width={size}
        height={size}
        className={className}
        style={{ objectFit: "contain" }}
        referrerPolicy="no-referrer"
        onError={() => setFailedUrl(logoUrl)}
      />
    );
  }
  return <ConnectorBrandIcon provider={provider} size={size} className={className} />;
}
