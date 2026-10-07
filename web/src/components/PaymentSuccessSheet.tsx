type Props = {
  heading?: string;
  title: string;
  subtitle: string;
  note?: string;
  priceUah?: number;
  failed?: boolean;
  /** Shown when that booking used the last session on the pass. */
  onRenew?: () => void;
  closing: boolean;
  onClose: () => void;
};

export function PaymentSuccessSheet({
  heading,
  title,
  subtitle,
  note,
  priceUah,
  failed = false,
  onRenew,
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
        {priceUah !== undefined ? <p className="success-price">{priceUah} грн</p> : null}
        {note ? <p className="success-note">{note}</p> : null}
        {onRenew ? (
          <div className="success-actions">
            <button type="button" className="pay-btn primary" onClick={onRenew}>
              <span>хочу ще</span>
            </button>
            <button type="button" className="pay-btn" onClick={onClose}>
              потім
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
