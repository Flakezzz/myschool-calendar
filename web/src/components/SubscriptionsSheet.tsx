import { Subscription } from "../data/subscriptions";

type Props = {
  subscriptions: Subscription[];
  /** Id of the plan currently being purchased, if any. */
  busyId: string | null;
  closing: boolean;
  onClose: () => void;
  onBuy: (sub: Subscription) => void;
};

export function SubscriptionsSheet({ subscriptions, busyId, closing, onClose, onBuy }: Props) {
  return (
    <div className={`sheet-backdrop${closing ? " closing" : ""}`} onClick={onClose} role="presentation">
      <article className={`sheet${closing ? " closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <header>
          <h2>Абонементи</h2>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Закрити">
            ✕
          </button>
        </header>
        <p className="sheet-desc">Купіть абонемент і відвідуйте клаби без окремої оплати за кожен.</p>
        <ul className="sub-list">
          {subscriptions.map((sub) => (
            <li key={sub.id} className="sub-card">
              <div className="sub-top">
                <strong>{sub.title}</strong>
                <em>{sub.priceUah} ₴</em>
              </div>
              <p className="sub-sessions">{sub.sessions}</p>
              <p className="sub-desc">{sub.description}</p>
              <button
                type="button"
                className="pay-btn"
                disabled={busyId !== null}
                onClick={() => onBuy(sub)}
              >
                {busyId === sub.id ? "Оформлюємо…" : "Придбати"}
              </button>
            </li>
          ))}
        </ul>
      </article>
    </div>
  );
}
