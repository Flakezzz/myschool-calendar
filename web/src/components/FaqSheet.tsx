type Props = {
  closing: boolean;
  onClose: () => void;
};

/** The three rules people actually ask about, in the client's own wording. */
const ITEMS = [
  {
    q: "скільки діє абонемент?",
    a: "абон діє місяць з моменту купівлі",
  },
  {
    q: "що буде з невикористаними візитами за місяць?",
    a: "невикористані відвідування згорають і не переносяться на наступний місяць",
  },
  {
    q: "за скільки можна скасувати візит на клаб?",
    a: "візит можна скасувати за 24 години, якщо відмінюєш заняття день в день, воно згорає",
  },
];

const CONTACT = "myschool_eng";

/* The ring around the badge. Each letter is placed on its own rather than
   run along a path: a path spaces them by glyph width, which bunched "шп"
   together, while she has them evenly spread. The space is a slot that
   stays empty, which is the gap she leaves between "маєш" and "питання".
   RING_START turns the whole ring so "п" sits at about two o'clock. */
const RING = "питання маєш";
const RING_START = 55;

export function FaqSheet({ closing, onClose }: Props) {
  return (
    <div className={`sheet-backdrop${closing ? " closing" : ""}`} onClick={onClose} role="presentation">
      <article className={`sheet faq-sheet${closing ? " closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <header>
          <h2>маєш питання?</h2>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Закрити">
            ✕
          </button>
        </header>

        {/* Her badge, measured off the Figma export: the disc is outlined
            black and the question mark is white with a black outline, while
            "питання маєш" runs the whole way round — not along an arc. The
            ring radius is 1.5x the disc, as it is in her file. Giving the
            text a textLength of the full circumference spreads the letters
            evenly over 360°, and the offset puts "п" at about two o'clock,
            where she starts it. */}
        <svg className="faq-mark" viewBox="0 0 160 160" role="img" aria-label="питання маєш?">
          <circle className="faq-mark-disc" cx="80" cy="80" r="40" />
          <text className="faq-mark-q" x="80" y="81" textAnchor="middle" dominantBaseline="central">
            ?
          </text>
          {RING.split("").map((ch, i) =>
            ch === " " ? null : (
              <text
                key={i}
                className="faq-mark-ring"
                x="80"
                y="20"
                textAnchor="middle"
                dominantBaseline="central"
                transform={`rotate(${RING_START + i * (360 / RING.length)} 80 80)`}
              >
                {ch}
              </text>
            ),
          )}
        </svg>

        <ul className="faq-list">
          {ITEMS.map((item) => (
            <li key={item.q}>
              <p className="faq-q">{item.q}</p>
              <p className="faq-a">{item.a}</p>
            </li>
          ))}
        </ul>

        <p className="faq-contact">
          питання і пропозиції пишіть сюди{" "}
          <a href={`https://t.me/${CONTACT}`} target="_blank" rel="noreferrer">
            @{CONTACT}
          </a>
        </p>
      </article>
    </div>
  );
}
