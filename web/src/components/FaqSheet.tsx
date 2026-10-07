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
