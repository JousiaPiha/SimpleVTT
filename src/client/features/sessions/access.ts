import { create } from "zustand";

// Portaled dialogs are outside the editor's inert DOM subtree. Hide their
// surfaces during a transition/error without discarding their React drafts.
export const useSessionAccess = create(() => ({ blocked: true }));
