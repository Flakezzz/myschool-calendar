import { Club } from "../data/clubs";
import { ShareIcon } from "./Icons";
import { passSessionsLeft, type MyPass } from "../lib/api";

type Props = {
  club: Club;
  closing: boolean;
  /** Set when the current user already has a booking for this club. */
  bookedRegistrationId: string | null;
  /** The pass this booking would spend, if the user has one with sessions left. */
  pass: MyPass | null;
  busy: boolean;
  onClose: () => void;
  onPay: (club: Club) => void;
  onCancel: (registrationId: string) => void;
  onOpenSubscriptions: () => void;
  onShare: (club: Club) => void;
  minSubPrice: number;
};

export function ClubSheet({
  club,
  closing,
  bookedRegistrationId,
  pass,
  busy,
  onClose,
  onPay,
  onCancel,
  onOpenSubscriptions,
  onShare,
  minSubPrice,
}: Props) {
  const left = club.seats - club.taken;
  const full = left <= 0;
  const booked = !!bookedRegistrationId;
  const sessionsLeft = pass ? passSessionsLeft(pass) : null;

  return (
    <div className={`sheet-backdrop${closing ? " closing" : ""}`} onClick={onClose} role="presentation">
      <article className={`sheet${closing ? " closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <header>
          <h2>{club.title}</h2>
          <div className="sheet-head-actions">
            <button
              className="icon-btn"
              type="button"
              onClick={() => onShare(club)}
              aria-label="Поділитись клабом"
            >
              <ShareIcon width={18} height={18} />
            </button>
            <button className="icon-btn" type="button" onClick={onClose} aria-label="Закрити">
              ✕
            </button>
          </div>
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

        {booked ? (
          <p className="sheet-note is-booked">✓ Ви записані на цей клаб</p>
        ) : pass ? (
          <p className="sheet-note">
            Ваш абонемент «{pass.title}»:{" "}
            {sessionsLeft === null ? "безліміт" : `залишилось ${sessionsLeft}`} — цей запис буде
            безкоштовним.
          </p>
        ) : null}

        <div className="sheet-actions">
          {booked ? (
            <button
              className="pay-btn danger"
              type="button"
              disabled={busy}
              onClick={() => onCancel(bookedRegistrationId!)}
            >
              <span>{busy ? "Скасовуємо…" : "Скасувати запис"}</span>
            </button>
          ) : (
            <button className="pay-btn primary" type="button" disabled={full || busy} onClick={() => onPay(club)}>
              {full ? (
                <span>Немає місць</span>
              ) : (
                <>
                  <span>{busy ? "Записуємо…" : "Записатись"}</span>
                  <em>{pass ? "за абонементом" : `${club.priceUah} ₴`}</em>
                </>
              )}
            </button>
          )}
          <button className="pay-btn secondary" type="button" onClick={onOpenSubscriptions}>
            <span>Абонемент</span>
            <em>від {minSubPrice} ₴</em>
          </button>
        </div>
      </article>
    </div>
  );
}
