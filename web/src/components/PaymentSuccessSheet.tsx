type Props = {
  title: string;
  subtitle: string;
  priceUah: number;
  closing: boolean;
  onClose: () => void;
};

export function PaymentSuccessSheet({ title, subtitle, priceUah, closing, onClose }: Props) {
  return (
    <div className={`sheet-backdrop${closing ? " closing" : ""}`} onClick={onClose} role="presentation">
      <article className={`sheet success-sheet${closing ? " closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="success-icon" aria-hidden="true">
          ✓
        </div>
        <h2>Оплата успішна</h2>
        <p className="success-item">{title}</p>
        <p className="success-sub">{subtitle}</p>
        <p className="success-price">{priceUah} ₴</p>
        <button type="button" className="pay-btn" onClick={onClose}>
          Готово
        </button>
      </article>
    </div>
  );
}
