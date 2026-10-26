// The icons of the selection tools: inline SVG, in the colour of the text.
const iconProps = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

/** A mouse pointer. */
export const PointerIcon = () => (
  <svg {...iconProps}>
    <path d="M5 3l14 7.5-6.2 1.7L10 18.5z" />
    <path d="M13 13l5 5" />
  </svg>
);

/** A dashed square. */
export const RectangleIcon = () => (
  <svg {...iconProps}>
    <rect x="4" y="4" width="16" height="16" rx="1" strokeDasharray="3 3" />
  </svg>
);
