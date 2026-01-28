"use client";

import { Toast, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast";
import { useToast } from "@/components/ui/use-toast";

function ToastRenderer() {
  const { toasts, dismissToast } = useToast();
  return (
    <>
      {toasts.map((toast) => (
        <Toast key={toast.id} onOpenChange={(open) => !open && dismissToast(toast.id)}>
          {toast.title ? <ToastTitle>{toast.title}</ToastTitle> : null}
          {toast.description ? <ToastDescription>{toast.description}</ToastDescription> : null}
        </Toast>
      ))}
      <ToastViewport />
    </>
  );
}

export function Toaster() {
  return (
    <ToastProvider swipeDirection="right" duration={3500}>
      <ToastRenderer />
    </ToastProvider>
  );
}
