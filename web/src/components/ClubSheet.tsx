import { Club } from "../data/clubs";

type Props = {
  club: Club;
  onClose: () => void;
  onPay: (club: Club) => void;
};

export function ClubSheet({ club, onClose, onPay }: Props) {
  const left = club.seats - club.taken;
  const full = left <= 0;

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <article className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <header>
          <h2>{club.title}</h2>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Закрити">
            ✕
          </button>
        </header>
        <p className="sheet-desc">{club.description}</p>
        <dl className="facts">
          <div>
            <dt>Час</dt>
            <dd>
              {club.startTime}–{club.endTime}
            </dd>
          </div>
          <div>
            <dt>Викладач</dt>
            <dd>{club.teacher}</dd>
          </div>
          <div>
            <dt>Рівень</dt>
            <dd>{club.level}</dd>
          </div>
          <div>
            <dt>Місця</dt>
            <dd>
              {club.taken}/{club.seats}
            </dd>
          </div>
        </dl>
        <button
          className="pay-btn"
          type="button"
          disabled={full}
          onClick={() => onPay(club)}
        >
          {full ? "Немає місць" : `Зареєструватись · ${club.priceUah} ₴`}
        </button>
      </article>
    </div>
  );
}
