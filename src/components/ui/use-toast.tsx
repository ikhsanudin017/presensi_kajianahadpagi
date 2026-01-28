"use client";

import * as React from "react";

export type ToastMessage = {
  id: string;
  title?: string;
  description?: string;
  variant?: "default" | "success" | "warning" | "destructive";
};

type ToastContextValue = {
  toasts: ToastMessage[];
  showToast: (toast: Omit<ToastMessage, "id">) => void;
  dismissToast: (id: string) => void;
};

const ToastContext = React.createContext<ToastContextValue | undefined>(undefined);

export function ToastProviderInner({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastMessage[]>([]);

  const showToast = React.useCallback((toast: Omit<ToastMessage, "id">) => {
    setToasts((prev) => [...prev, { ...toast, id: crypto.randomUUID() }]);
  }, []);

  const dismissToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, showToast, dismissToast }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProviderInner");
  }
  return context;
}
