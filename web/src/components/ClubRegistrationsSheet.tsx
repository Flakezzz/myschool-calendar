import type { Club } from "../data/clubs";
import type { ClubRegistration } from "../lib/api";
import { formatShortDate } from "../lib/dates";

type Props = {
  club: Club;
  registrations: ClubRegistration[];
  loading: boolean;
  error: string | null;
  closing: boolean;
  onClose: () => void;
};

export function ClubRegistrationsSheet({
  club,
  registrations,
  loading,
  error,
  closing,
  onClose,
}: Props) {
  const paid = registrations.reduce((sum, r) => sum + (r.pricePaidUah ?? 0), 0);

  return (
    <div className={`sheet-backdrop${closing ? " closing" : ""}`} onClick={onClose} role="presentation">
      <article className={`sheet${closing ? " closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <header>
          <h2>Записані</h2>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Закрити">
            ✕
          </button>
        </header>
        <p className="sheet-desc">
          {club.title} · {formatShortDate(club.date)} о {club.startTime}
        </p>

        {error ? <p className="form-error">{error}</p> : null}

        {loading ? (
          <p className="sheet-desc">завантажуємо…</p>
        ) : registrations.length ? (
          <>
            <dl className="facts">
              <div>
                <dt>Записалось</dt>
                <dd>
                  {registrations.length}/{club.seats}
                </dd>
              </div>
              <div>
                <dt>Сплачено готівкою</dt>
                <dd>{paid} ₴</dd>
              </div>
            </dl>
            <ul className="admin-list">
              {registrations.map((reg, index) => (
                <li key={reg.id} className="admin-row">
                  <div className="admin-row-info">
                    <strong>
                      {index + 1}. {reg.name || `ID ${reg.telegramUserId}`}
                    </strong>
                    <span>
                      {reg.username ? `@${reg.username} · ` : ""}
                      {reg.paidWith === "subscription" ? "абонемент" : `${reg.pricePaidUah ?? 0} ₴`}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="sheet-desc">Поки ніхто не записався.</p>
        )}
      </article>
    </div>
  );
}
