/**
 * Line icons, drawn to one spec: 24x24 box, 1.5 stroke, round caps and joins,
 * no fills. They inherit `currentColor` so the same icon works on cream and on
 * forest without a second copy.
 */

type IconProps = { size?: number; className?: string };

function Svg({ size = 24, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

/** Two scripts side by side — the Hindi + English promise. */
export const IconLanguage = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="4" width="19" height="16" rx="3" />
    <path d="M6 9h5M8.5 9v6M13.5 15l2.5-6 2.5 6M14.6 13h2.8" />
  </Svg>
);

export const IconMic = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="2.5" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" />
  </Svg>
);

export const IconShield = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 2.8 19.5 6v5.6c0 4.3-3 7.7-7.5 9.6-4.5-1.9-7.5-5.3-7.5-9.6V6Z" />
    <path d="m9 12 2.2 2.2L15.2 10" />
  </Svg>
);

export const IconCoins = (p: IconProps) => (
  <Svg {...p}>
    <ellipse cx="12" cy="6.2" rx="7.5" ry="3.2" />
    <path d="M4.5 6.2v5.3c0 1.8 3.4 3.2 7.5 3.2s7.5-1.4 7.5-3.2V6.2" />
    <path d="M4.5 11.5v5.3c0 1.8 3.4 3.2 7.5 3.2s7.5-1.4 7.5-3.2v-5.3" />
  </Svg>
);

export const IconHeart = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 20.3C7 17 3.5 13.9 3.5 10.2A4.2 4.2 0 0 1 12 8a4.2 4.2 0 0 1 8.5 2.2c0 3.7-3.5 6.8-8.5 10.1Z" />
  </Svg>
);

export const IconBrain = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5.2a2.9 2.9 0 0 0-5.4-.6A2.8 2.8 0 0 0 4 9.3a2.9 2.9 0 0 0 .7 4.6A2.9 2.9 0 0 0 9 18.6a2.9 2.9 0 0 0 3-1.4Z" />
    <path d="M12 5.2a2.9 2.9 0 0 1 5.4-.6A2.8 2.8 0 0 1 20 9.3a2.9 2.9 0 0 1-.7 4.6A2.9 2.9 0 0 1 15 18.6a2.9 2.9 0 0 1-3-1.4Z" />
    <path d="M12 5.2v12" />
  </Svg>
);

export const IconBell = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 8.6a6 6 0 1 0-12 0c0 5-2 6.4-2 6.4h16s-2-1.4-2-6.4Z" />
    <path d="M13.7 19a2 2 0 0 1-3.4 0" />
  </Svg>
);

export const IconLock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
    <path d="M8 10.5V7.6a4 4 0 1 1 8 0v2.9M12 14.6v2" />
  </Svg>
);

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="m4.5 12.5 4.5 4.5L19.5 7" />
  </Svg>
);

export const IconArrow = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 12h15M13.5 6l6 6-6 6" />
  </Svg>
);

export const IconPlay = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8.5 5.6 18 12l-9.5 6.4Z" />
  </Svg>
);

/** The mark: a leaf pair, used in the nav and the footer. */
export function Logo({ size = 28, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      {/* Two leaves meeting at a stem: the smaller one behind, the taller in
          front, so the mark still reads at 16px in the dashboard sidebar. */}
      <path
        d="M15.2 30C15.2 21.2 11.2 15.4 3.2 13.6c-1 8.8 3.4 15 12 16.4Z"
        fill="currentColor"
        opacity="0.5"
      />
      <path
        d="M16.8 30c-1.4-10.6 2.6-18.6 12-22.4 1.8 10.4-2.6 18.6-12 22.4Z"
        fill="currentColor"
      />
      <path
        d="M16 30c0-4.4.6-8 1.8-11"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
        opacity="0.8"
      />
    </svg>
  );
}
