import { useEffect } from "react";

/** Prevents the page behind a sheet from scrolling — mainly matters on iOS
 * WebViews, where a fixed-position overlay doesn't reliably block scroll on
 * the body underneath it. */
export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const { overflow, position, width, top } = document.body.style;
    const scrollY = window.scrollY;
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.width = "100%";
    document.body.style.top = `-${scrollY}px`;
    return () => {
      document.body.style.overflow = overflow;
      document.body.style.position = position;
      document.body.style.width = width;
      document.body.style.top = top;
      window.scrollTo(0, scrollY);
    };
  }, [active]);
}
