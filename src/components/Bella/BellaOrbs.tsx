interface BellaOrbsProps {
  /** Rendered size in px. The orbs are sized in %, so any value works. */
  size?: number;
  /** Orbit while true; hold the logo pose while false. */
  active?: boolean;
  className?: string;
}

/**
 * The twin orbs from the dermodel mark, as a live element.
 *
 * Built from CSS gradients rather than the logo image on purpose: the source
 * asset is a 1.4 MB 1102px PNG, which is absurd for a 24px chip, and gradients
 * stay sharp at any size with nothing to download.
 *
 * Decorative — the "Bella" wordmark next to it carries the meaning, so this is
 * aria-hidden rather than adding a redundant label for screen readers.
 */
export const BellaOrbs = ({ size = 24, active = false, className = '' }: BellaOrbsProps) => (
  <span
    aria-hidden="true"
    className={`relative inline-block shrink-0 ${className}`}
    style={{ width: size, height: size }}
  >
    <span className={`bella-orb bella-orb-a${active ? ' is-orbiting' : ''}`} />
    <span className={`bella-orb bella-orb-b${active ? ' is-orbiting' : ''}`} />
  </span>
);
