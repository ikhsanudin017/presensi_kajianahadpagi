"use client";

import { ToastProviderInner } from "@/components/ui/use-toast";
import { Toaster } from "@/components/ui/toaster";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ToastProviderInner>
      {children}
      <Toaster />
    </ToastProviderInner>
  );
}
