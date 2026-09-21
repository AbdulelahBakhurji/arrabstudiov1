/**
 * A face, not initials. Each companion gets one drawing for life, derived from
 * their seed, and one colour that never changes in either theme.
 *
 * Rings carry meaning: gold means this person is speaking or is about to,
 * a faint ring means they contributed, and nothing means they are quiet.
 */
import { useId, useState } from "react";
import { cn } from "@/lib/utils";

export type FaceState = "quiet" | "lit" | "speaking" | "contributing";

const SIZES = { sm: 28, md: 40, lg: 56, xl: 76 } as const;

export type FaceSize = keyof typeof SIZES;

function pick<T>(options: readonly T[], seed: number, salt: number): T {
  return options[Math.abs(Math.floor(seed / salt)) % options.length]!;
}

export function CompanionFace({
  name,
  hue,
  seed,
  size = "md",
  state = "quiet",
  className,
}: {
  name: string;
  hue: number;
  seed: number;
  size?: FaceSize;
  state?: FaceState;
  className?: string;
}) {
  // Ids must be unique per rendered face — seeds can repeat.
  const clipId = useId();
  const px = SIZES[size];
  // Skin tone varies in lightness too, not just hue — two companions with the
  // same accent color still don't look like the same person.
  const skinLightness = pick([54, 60, 66, 72, 78] as const, seed, 5);
  const skin = `hsl(${hue} 34% ${skinLightness}%)`;
  const skinShade = `hsl(${hue} 32% ${skinLightness - 12}%)`;
  // Hair color is its own choice, independent of the accent hue — dark,
  // warm brown, and ash/grey all show up, again the way real hair does.
  const hairHsl = pick(
    [
      [(hue + 205) % 360, 26, 16],
      [28, 42, 30],
      [18, 55, 42],
      [0, 0, 88],
      [(hue + 40) % 360, 20, 22],
    ] as const,
    seed,
    13,
  );
  const hair = `hsl(${hairHsl[0]} ${hairHsl[1]}% ${hairHsl[2]}%)`;
  const garment = `hsl(${hue} 30% 30%)`;
  const backdrop = `hsl(${hue} 40% 20%)`;

  const hairStyle = pick(["crop", "wave", "bun", "curls", "hood", "shave", "part"] as const, seed, 3);
  const eyeStyle = pick(["round", "calm", "wide", "sharp"] as const, seed, 7);
  const mouthStyle = pick(["soft", "line", "half", "grin"] as const, seed, 11);
  const glasses = seed % 5 === 0;

  return (
    <span
      className={cn("companion-face relative inline-flex shrink-0", className)}
      style={{ width: px, height: px }}
      data-state={state}
      title={name}
    >
      <svg viewBox="0 0 64 64" width={px} height={px} role="img" aria-label={name}>
        <defs>
          <clipPath id={clipId}>
            <circle cx="32" cy="32" r="32" />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <circle cx="32" cy="32" r="32" fill={backdrop} />

          {/* shoulders, then neck, then head — so nothing floats over the chin */}
          <path d="M4 64c3-11 13-17 28-17s25 6 28 17z" fill={garment} />
          <rect x="27" y="35" width="10" height="13" rx="5" fill={skinShade} />
          <ellipse cx="17.5" cy="30" rx="2.4" ry="3" fill={skinShade} />
          <ellipse cx="46.5" cy="30" rx="2.4" ry="3" fill={skinShade} />
          <ellipse cx="32" cy="28" rx="15" ry="16.5" fill={skin} />

          {hairStyle === "crop" ? (
            <path d="M17 26c0-9 7-14 15-14s15 5 15 14c-3-6-8-8-15-8s-12 2-15 8z" fill={hair} />
          ) : null}
          {hairStyle === "wave" ? (
            <path
              d="M16.6 28c-1-11 6-17 15.4-17s16.4 6 15.4 17c-1.6-1-2.4-3.6-2.4-7.4-4 3.8-8.6 4.8-13 4.8s-9-1-13-4.8c0 3.8-.8 6.4-2.4 7.4z"
              fill={hair}
            />
          ) : null}
          {hairStyle === "bun" ? (
            <>
              <circle cx="32" cy="8.5" r="4.6" fill={hair} />
              <path d="M17 26c0-10 7-15 15-15s15 5 15 15c-4-7-9-9-15-9s-11 2-15 9z" fill={hair} />
            </>
          ) : null}
          {hairStyle === "curls" ? (
            <>
              <circle cx="21" cy="20.5" r="5.4" fill={hair} />
              <circle cx="32" cy="15.5" r="6.4" fill={hair} />
              <circle cx="43" cy="20.5" r="5.4" fill={hair} />
              <path d="M17 25c0-8 7-13 15-13s15 5 15 13c-4-6-9-8-15-8s-11 2-15 8z" fill={hair} />
            </>
          ) : null}
          {/* A scarf that frames the face without covering it. */}
          {hairStyle === "hood" ? (
            <>
              <path
                d="M14 33c0-14 8-22 18-22s18 8 18 22c0 8-2 14-4 18l-4-2c2-4 3-9 3-15 0-9-6-14-13-14s-13 5-13 14c0 6 1 11 3 15l-4 2c-2-4-4-10-4-18z"
                fill={hair}
              />
              <path d="M18 22c3-7 8-11 14-11s11 4 14 11c-4-5-8-7-14-7s-10 2-14 7z" fill={hair} />
            </>
          ) : null}
          {/* Close-cropped, almost buzzed — just a thin line of color at the crown. */}
          {hairStyle === "shave" ? (
            <path d="M18 21.5c3-6.5 8-10 14-10s11 3.5 14 10c-4-3-9-4.5-14-4.5s-10 1.5-14 4.5z" fill={hair} />
          ) : null}
          {/* Side part — the crop silhouette with a parting line cut through it. */}
          {hairStyle === "part" ? (
            <>
              <path d="M17 26c0-9 7-14 15-14s15 5 15 14c-3-6-8-8-15-8s-12 2-15 8z" fill={hair} />
              <path d="M23 13.5 22 22" stroke={backdrop} strokeWidth="1.3" strokeLinecap="round" />
            </>
          ) : null}

          {/* brows */}
          <path d="M23 24.5c2-1.4 4-1.4 6 0" stroke={hair} strokeWidth="1.4" fill="none" strokeLinecap="round" />
          <path d="M35 24.5c2-1.4 4-1.4 6 0" stroke={hair} strokeWidth="1.4" fill="none" strokeLinecap="round" />

          {eyeStyle === "round" ? (
            <>
              <circle cx="26" cy="29" r="2.1" fill="#101013" />
              <circle cx="38" cy="29" r="2.1" fill="#101013" />
            </>
          ) : null}
          {eyeStyle === "calm" ? (
            <>
              <path d="M23.6 29.4c1.6-2 3.2-2 4.8 0" stroke="#101013" strokeWidth="1.8" fill="none" strokeLinecap="round" />
              <path d="M35.6 29.4c1.6-2 3.2-2 4.8 0" stroke="#101013" strokeWidth="1.8" fill="none" strokeLinecap="round" />
            </>
          ) : null}
          {eyeStyle === "wide" ? (
            <>
              <ellipse cx="26" cy="29" rx="2.4" ry="2.8" fill="#101013" />
              <ellipse cx="38" cy="29" rx="2.4" ry="2.8" fill="#101013" />
            </>
          ) : null}
          {eyeStyle === "sharp" ? (
            <>
              <path d="M23.6 28.6h4.8" stroke="#101013" strokeWidth="2" fill="none" strokeLinecap="round" />
              <path d="M35.6 28.6h4.8" stroke="#101013" strokeWidth="2" fill="none" strokeLinecap="round" />
            </>
          ) : null}

          {glasses ? (
            <g stroke="#0f0f12" strokeWidth="1.2" fill="none" opacity="0.75">
              <circle cx="26" cy="29" r="4.6" />
              <circle cx="38" cy="29" r="4.6" />
              <path d="M30.6 29h2.8" />
            </g>
          ) : null}

          {mouthStyle === "soft" ? (
            <path d="M28 36.5c2.4 2 5.6 2 8 0" stroke="#2a1a1a" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          ) : null}
          {mouthStyle === "line" ? (
            <path d="M28.5 37h7" stroke="#2a1a1a" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          ) : null}
          {mouthStyle === "half" ? (
            <path d="M29 36.4c2 1.8 4 2 6 .4" stroke="#2a1a1a" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          ) : null}
          {mouthStyle === "grin" ? (
            <path
              d="M27.5 36c3 3 6 3 9 0"
              stroke="#2a1a1a"
              strokeWidth="1.6"
              fill={skinShade}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
        </g>
      </svg>
    </span>
  );
}

/**
 * The same circular frame as CompanionFace, but for a photo — uploaded, camera,
 * or photoreal portrait. Shows a soft placeholder while loading; falls back to
 * the drawn face only if the image fails.
 */
export function PhotoAvatar({
  src,
  name,
  size = "md",
  state = "quiet",
  className,
  fallbackHue = 220,
  fallbackSeed = 41,
}: {
  src: string;
  name: string;
  size?: FaceSize;
  state?: FaceState;
  className?: string;
  fallbackHue?: number;
  fallbackSeed?: number;
}) {
  const px = SIZES[size];
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadedSrc, setLoadedSrc] = useState(src);
  if (loadedSrc !== src) {
    setLoadedSrc(src);
    setFailed(false);
    setLoaded(false);
  }

  if (failed) {
    return (
      <CompanionFace
        name={name}
        hue={fallbackHue}
        seed={fallbackSeed}
        size={size}
        state={state}
        className={className}
      />
    );
  }

  return (
    <span
      className={cn("companion-face relative inline-flex shrink-0", className)}
      style={{
        width: px,
        height: px,
        background: loaded
          ? undefined
          : `linear-gradient(145deg, hsl(${fallbackHue} 28% 42%), hsl(${fallbackHue} 32% 28%))`,
      }}
      data-state={state}
      title={name}
    >
      <img
        src={src}
        width={px}
        height={px}
        alt={name}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        style={{ opacity: loaded ? 1 : 0, transition: "opacity 0.2s ease" }}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </span>
  );
}

/** The dot used in lists and captions — same colour as the face, nothing else. */
export function CompanionDot({ hue, className }: { hue: number; className?: string }) {
  return (
    <span
      className={cn("inline-block size-1.5 shrink-0 rounded-full", className)}
      style={{ background: `hsl(${hue} 60% 62%)` }}
    />
  );
}
