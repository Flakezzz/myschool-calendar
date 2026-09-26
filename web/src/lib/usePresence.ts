import { useEffect, useRef, useState } from "react";

/** Keeps a node mounted for `duration` ms after `active` goes false, so an exit animation can play. */
export function usePresence(active: boolean, duration = 220) {
  const [rendered, setRendered] = useState(active);
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (active) {
      clearTimeout(timer.current);
      setClosing(false);
      setRendered(true);
    } else if (rendered) {
      setClosing(true);
      timer.current = setTimeout(() => {
        setRendered(false);
        setClosing(false);
      }, duration);
    }
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return { rendered, closing };
}
