import { useEffect, useId } from "react";
import { create } from "zustand";

interface DraftState {
  drafts: Record<string, string>;
  set: (id: string, label: string | null) => void;
}
export const useSessionDrafts = create<DraftState>((set) => ({
  drafts: {},
  set: (id, label) =>
    set((state) => {
      const drafts = { ...state.drafts };
      if (label) drafts[id] = label;
      else delete drafts[id];
      return { drafts };
    }),
}));

/** Explicit Save/Apply drafts must be handled before switching storage. */
export function useSessionDraft(label: string, dirty: boolean) {
  const id = useId();
  useEffect(() => {
    useSessionDrafts.getState().set(id, dirty ? label : null);
    return () => useSessionDrafts.getState().set(id, null);
  }, [id, label, dirty]);
}

export function draftWarning(drafts: Record<string, string>) {
  const labels = [...new Set(Object.values(drafts))];
  return labels.length
    ? `Save/apply or discard these drafts before changing sessions: ${labels.join(", ")}.`
    : null;
}
