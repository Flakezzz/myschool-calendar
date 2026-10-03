type Props = {
  heading?: string;
  title: string;
  subtitle: string;
  note?: string;
  priceUah?: number;
  failed?: boolean;
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
        <h2>{heading ?? (failed ? "Не вдалося записатися" : "Оплата успішна")}</h2>
        <p className="success-item">{title}</p>
        <p className="success-sub">{subtitle}</p>
        {priceUah !== undefined ? <p className="success-price">{priceUah} ₴</p> : null}
        {note ? <p className="success-note">{note}</p> : null}
        <button type="button" className="pay-btn" onClick={onClose}>
          {failed ? "Зрозуміло" : "Готово"}
        </button>
      </article>
    </div>
  );
}
