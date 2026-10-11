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

        {/* Her badge: a yellow disc with the question mark, and the words
            running around it. The ring is one circular path — 25% along it
            is the top, so the phrase sits centred over the disc. */}
        <svg className="faq-mark" viewBox="0 0 160 160" role="img" aria-label="питання маєш?">
          <defs>
            <path
              id="faq-ring-path"
              fill="none"
              d="M80,80 m-62,0 a62,62 0 1,1 124,0 a62,62 0 1,1 -124,0"
            />
          </defs>
          <circle className="faq-mark-disc" cx="80" cy="80" r="42" />
          <text className="faq-mark-q" x="80" y="80" textAnchor="middle" dominantBaseline="central">
            ?
          </text>
          <text className="faq-mark-ring">
            <textPath href="#faq-ring-path" startOffset="25%" textAnchor="middle">
              питання маєш?
            </textPath>
          </text>
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
