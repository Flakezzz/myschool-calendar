type Props = {
  title: string;
  subtitle: string;
  priceUah?: number;
  failed?: boolean;
  closing: boolean;
  onClose: () => void;
};

export function PaymentSuccessSheet({
  title,
  subtitle,
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
        <h2>{failed ? "Не вдалося записатися" : "Оплата успішна"}</h2>
        <p className="success-item">{title}</p>
        <p className="success-sub">{subtitle}</p>
        {priceUah !== undefined ? <p className="success-price">{priceUah} ₴</p> : null}
        <button type="button" className="pay-btn" onClick={onClose}>
          {failed ? "Зрозуміло" : "Готово"}
        </button>
      </article>
    </div>
  );
}
