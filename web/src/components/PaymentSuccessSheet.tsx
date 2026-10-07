type Props = {
  heading?: string;
  title: string;
  subtitle: string;
  /** Reassurance shown right after the date, before the pass counter. */
  calm?: string;
  note?: string;
  priceUah?: number;
  failed?: boolean;
  /** Shown when that booking used the last session on the pass. */
  onRenew?: () => void;
  /** Price line under "хочу ще", same shape as the Абонемент button. */
  renewHint?: string;
  closing: boolean;
  onClose: () => void;
};

export function PaymentSuccessSheet({
  heading,
  title,
  subtitle,
  calm,
  note,
  priceUah,
  failed = false,
  onRenew,
  renewHint,
  closing,
  onClose,
}: Props) {
  return (
    <div className={`sheet-backdrop${closing ? " closing" : ""}`} onClick={onClose} role="presentation">
      <article className={`sheet success-sheet${closing ? " closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className={`success-icon${failed ? " is-failed" : ""}`} aria-hidden="true">
          {failed ? "!" : "✓"}
        </div>
        <h2>{heading ?? (failed ? "не вдалося записатися" : "санчізес")}</h2>
        <p className="success-item">{title}</p>
        <p className="success-sub">{subtitle}</p>
        {calm ? <p className="success-calm">{calm}</p> : null}
        {priceUah !== undefined ? <p className="success-price">{priceUah} грн</p> : null}
        {note ? <p className="success-note">{note}</p> : null}
        {onRenew ? (
          <div className="success-actions">
            <button type="button" className="pay-btn" onClick={onClose}>
              потім
            </button>
            <button type="button" className="pay-btn secondary" onClick={onRenew}>
              <span>хочу ще</span>
              {renewHint ? <em>{renewHint}</em> : null}
            </button>
          </div>
        ) : (
          <button type="button" className="pay-btn" onClick={onClose}>
            {failed ? "зрозуміло" : "найс"}
          </button>
        )}
      </article>
    </div>
  );
}
