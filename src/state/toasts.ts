"use client";

import { create } from "zustand";

// Short-lived event toasts: squadmates joining/leaving/going down, repairs,
// your own crash. Tiny zustand list, auto-expiring. Rendered by Toasts.tsx.

export type ToastTone = "info" | "good" | "bad";

export interface Toast {
  id: number;
  text: string;
  tone: ToastTone;
}

interface ToastStore {
  toasts: Toast[];
  dismiss: (id: number) => void;
}

const TOAST_MS = 3500;
const MAX_TOASTS = 4;
let nextId = 1;

export const useToasts = create<ToastStore>((set) => ({
  toasts: [],
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export function toast(text: string, tone: ToastTone = "info"): void {
  const id = nextId++;
  useToasts.setState((s) => ({ toasts: [...s.toasts, { id, text, tone }].slice(-MAX_TOASTS) }));
  setTimeout(() => useToasts.getState().dismiss(id), TOAST_MS);
}
