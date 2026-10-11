type Props = {
  /** Rendered width and height in px. */
  size?: number;
  className?: string;
};

/**
 * The World4D mark: a globe whose clock hands form an R, with a W as its
 * southern latitude line ("rapidwine").
 *
 * The R's two hands (the upright stroke and the diagonal leg) are separate
 * groups pinned at the centre, so CSS can spin them on hover: see `.logo-hand-*`
 * in index.css. The curved bowl of the R stays still.
 *
 * Keep in sync with public/favicon.svg (the same artwork on a dark tile).
 */
export default function Logo({ size = 32, className }: Props) {
  return (
    <svg
      className={className ? `logo ${className}` : 'logo'}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="50" cy="50" r="40" fill="none" className="logo-teal" strokeWidth="6" />
      <ellipse
        cx="50"
        cy="50"
        rx="26"
        ry="40"
        fill="none"
        className="logo-teal"
        strokeWidth="3"
        opacity="0.5"
      />
      <path
        d="M22 70 L33 82 L50 72 L67 82 L78 70"
        fill="none"
        className="logo-teal"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M50 30 H59 A10 10 0 0 1 59 50 H50"
        fill="none"
        className="logo-amber"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g className="logo-hand-a">
        <path d="M50 64 V30" className="logo-amber" strokeWidth="6" strokeLinecap="round" />
      </g>
      <g className="logo-hand-b">
        <path d="M50 50 L64 66" className="logo-amber" strokeWidth="6" strokeLinecap="round" />
      </g>
      <circle cx="50" cy="50" r="5" className="logo-pin" />
    </svg>
  );
}
