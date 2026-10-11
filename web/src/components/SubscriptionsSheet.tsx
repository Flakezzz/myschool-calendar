import { Subscription } from "../data/subscriptions";
import { passSessionsLeft, type MyPass } from "../lib/api";

/** The client wants each tier to answer differently, cheapest first. */
const BUY_LABELS = ["хочу", "беру", "дуже хочу"];

/** And each tier's "N клабів на місяць" line carries its own colour in her
 * Figma — blue, then yellow, then red as the plans get bigger. */
const TIER_CLASS = ["is-tier-1", "is-tier-2", "is-tier-3"];

type Props = {
  subscriptions: Subscription[];
  /** The pass the user already holds, if any — only one at a time. */
  activePass: MyPass | null;
  /** Id of the plan currently being purchased, if any. */
  busyId: string | null;
  closing: boolean;
  onClose: () => void;
  onBuy: (sub: Subscription) => void;
};

export function SubscriptionsSheet({
  subscriptions,
  activePass,
  busyId,
  closing,
  onClose,
  onBuy,
}: Props) {
  const sessionsLeft = activePass ? passSessionsLeft(activePass) : null;
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
        <p className="sheet-subtitle">зі знижечками</p>
        {activePass ? (
          <p className="sheet-note">
            <strong>
              У вас уже є абонемент «{activePass.title}»:{" "}
              {sessionsLeft === null ? "безліміт" : `лишилось ${sessionsLeft}`}.
            </strong>{" "}
            Новий можна придбати, коли цей закінчиться.
          </p>
        ) : (
          <p className="sheet-desc">бери абон і ходи на клаби без окремої оплати за кожен</p>
        )}
        <ul className="sub-list">
          {subscriptions.map((sub, i) => (
            <li key={sub.id} className="sub-card">
              <div className="sub-top">
                <strong>{sub.title}</strong>
                <em>{sub.priceUah} грн</em>
              </div>
              <p className={`sub-sessions ${TIER_CLASS[i] ?? TIER_CLASS[0]}`}>{sub.sessions}</p>
              <p className="sub-desc">{sub.description}</p>
              <button
                type="button"
                className="pay-btn"
                disabled={busyId !== null || !!activePass}
                onClick={() => onBuy(sub)}
              >
                {busyId === sub.id ? "оформлюємо…" : BUY_LABELS[i] ?? "хочу"}
              </button>
            </li>
          ))}
        </ul>
      </article>
    </div>
  );
}
