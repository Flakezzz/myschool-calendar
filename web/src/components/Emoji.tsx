type Props = {
  children: string;
  /** Box size in px; the glyph is drawn to fill most of it. */
  size?: number;
};

/** An emoji that is actually centred, on every platform.
 *
 * Centring an emoji as ordinary text does not work reliably: the browser
 * centres its *line box*, and emoji fonts have lopsided ascent and descent
 * — Noto gives 18 up against 6 down at 18px, Apple Color Emoji something
 * else again — so the picture ends up sitting high by an amount that
 * differs per platform. A pixel nudge tuned on one machine is wrong on the
 * next, which is exactly what went wrong on the phone.
 *
 * So the baseline is placed by hand instead, half the glyph's own height
 * below the middle. Emoji fonts draw their ink from roughly the ascender
 * down to a little under the baseline, which puts the ink's centre about
 * 0.35em above it — the same constant used for centring ordinary type, and
 * close enough on both Noto and Apple Color Emoji to be invisible. Because
 * it is in em it scales with the glyph instead of being a pixel count tuned
 * on one machine.
 *
 * `dominant-baseline="central"` would say this more directly, but engines
 * disagree about honouring it on <text>, and one that ignores it leaves the
 * glyph high — which is the bug this is here to avoid.
 */
export function Emoji({ children, size = 20 }: Props) {
  return (
    <svg
      className="emoji"
      viewBox="0 0 20 20"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <text x="10" y="10" dy="0.35em" textAnchor="middle" fontSize="15">
        {children}
      </text>
    </svg>
  );
}
