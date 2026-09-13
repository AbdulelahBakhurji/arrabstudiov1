/**
 * A face, not initials. Each companion gets one drawing for life, derived from
 * their seed, and one colour that never changes in either theme.
 *
 * Rings carry meaning: gold means this person is speaking or is about to,
 * a faint ring means they contributed, and nothing means they are quiet.
 */
import { useId } from "react";
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
  const skin = `hsl(${hue} 34% 66%)`;
  const skinShade = `hsl(${hue} 32% 54%)`;
  const hair = `hsl(${(hue + 205) % 360} 26% 16%)`;
  const garment = `hsl(${hue} 30% 30%)`;
  const backdrop = `hsl(${hue} 40% 20%)`;

  const hairStyle = pick(["crop", "wave", "bun", "curls", "hood"] as const, seed, 3);
  const eyeStyle = pick(["round", "calm", "wide"] as const, seed, 7);
  const mouthStyle = pick(["soft", "line", "half"] as const, seed, 11);
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
        </g>
      </svg>
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
