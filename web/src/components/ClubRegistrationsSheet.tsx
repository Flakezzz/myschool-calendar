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
  // This used to add up every price and call the total "готівкою", which
  // counted card payments as cash and counted unpaid 20-minute holds as
  // money in the drawer. Each way of paying is now its own number.
  const real = registrations.filter((r) => r.paymentState === "confirmed");
  const waiting = registrations.filter((r) => r.paymentState === "pending");
  const sumBy = (how: "cash" | "card") =>
    real.filter((r) => r.paidWith === how).reduce((sum, r) => sum + (r.pricePaidUah ?? 0), 0);
  const cash = sumBy("cash");
  const card = sumBy("card");
  const onPass = real.filter((r) => r.paidWith === "subscription").length;

  const howPaid = (reg: (typeof registrations)[number]) => {
    if (reg.paymentState === "pending") return "⏳ на оплаті";
    if (reg.paidWith === "subscription") return "абонемент";
    if (reg.paidWith === "card") return `${reg.pricePaidUah ?? 0} ₴ карткою`;
    return `${reg.pricePaidUah ?? 0} ₴ готівкою`;
  };

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
                  {real.length}/{club.seats}
                </dd>
              </div>
              <div>
                <dt>Карткою</dt>
                <dd>{card} ₴</dd>
              </div>
              <div>
                <dt>Готівкою</dt>
                <dd>{cash} ₴</dd>
              </div>
              <div>
                <dt>За абоном</dt>
                <dd>{onPass}</dd>
              </div>
            </dl>
            {waiting.length ? (
              <p className="sheet-note">
                ще {waiting.length} на оплаті — місце тримається до 20 хвилин, потім звільниться
              </p>
            ) : null}
            <ul className="admin-list">
              {[...real, ...waiting].map((reg, index) => (
                <li key={reg.id} className="admin-row">
                  <div className="admin-row-info">
                    <strong>
                      {index + 1}. {reg.name || `ID ${reg.telegramUserId}`}
                    </strong>
                    <span>
                      {reg.username ? `@${reg.username} · ` : ""}
                      {howPaid(reg)}
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
