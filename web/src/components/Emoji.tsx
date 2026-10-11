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
 *
 * One more thing the size has to account for: iOS inflates HTML text on its
 * own (text-size-adjust) but leaves SVG text alone, so the same number came
 * out visibly smaller on the phone than it had as plain text. Hence 25 in a
 * 40px button rather than the 18 it used to be.
 */
/** Glyph size in user units, and the box around it. The box is deliberately
 * roomier than the glyph: emoji ink reaches above the ascender and below
 * the baseline, and an SVG viewport clips, so a tight box shaves the edges
 * off. Keep the ratio if the size changes. */
const GLYPH = 25;
const BOX = 32;

export function Emoji({ children, size = BOX }: Props) {
  return (
    <svg
      className="emoji"
      viewBox={`0 0 ${BOX} ${BOX}`}
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <text x={BOX / 2} y={BOX / 2} dy="0.35em" textAnchor="middle" fontSize={GLYPH}>
        {children}
      </text>
    </svg>
  );
}
