import { useRef, useState } from "react";

/** One mutation at a time; a new mutation invalidates in-flight screen reads. */
export function useSettingsOperation() {
  const pending = useRef(false),
    epoch = useRef(0);
  const [busy, setBusy] = useState(false);
  return {
    pending,
    epoch,
    busy,
    begin() {
      if (pending.current) return false;
      pending.current = true;
      epoch.current++;
      setBusy(true);
      return true;
    },
    end() {
      pending.current = false;
      setBusy(false);
    },
  };
}
