import { useEffect, useState } from "react";
import { Platform } from "react-native";

/**
 * True for phones / coarse pointers (including Chrome device-mode).
 * False for fine-pointer desktop (mouse + hover).
 * Always true on native — those UIs use an explicit ≡ handle.
 */
export function useMobileDragUi(): boolean {
  const [mobile, setMobile] = useState(() => {
    if (Platform.OS !== "web") return true;
    if (typeof window === "undefined" || !window.matchMedia) return true;
    return window.matchMedia("(hover: none), (pointer: coarse)").matches;
  });

  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(hover: none), (pointer: coarse)");
    const sync = () => setMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return mobile;
}
