"use client";

import * as React from "react";
import { X } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

function useIsMobile(query = "(max-width: 767px)") {
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setIsMobile(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);

  return isMobile;
}

type ResponsiveDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  contentClassName?: string;
  bodyClassName?: string;
  hideCloseButton?: boolean;
};

export function ResponsiveDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  contentClassName,
  bodyClassName,
  hideCloseButton = false,
}: ResponsiveDialogProps) {
  const isMobile = useIsMobile();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "p-0 shadow-2xl bg-[hsl(var(--card))]",
          isMobile
            ? "bottom-0 left-1/2 top-auto w-[100vw] max-w-none -translate-x-1/2 -translate-y-0 rounded-b-none rounded-t-[28px] border-x-0 border-b-0"
            : "w-[94vw] max-w-xl rounded-[24px]",
          contentClassName
        )}
      >
        {/* Handle Bar untuk Mobile */}
        {isMobile && (
          <div className="flex justify-center pb-2 pt-3">
            <div className="h-1.5 w-12 rounded-full bg-muted-foreground/30"></div>
          </div>
        )}

        {!hideCloseButton ? (
          <DialogClose className={cn(
            "absolute right-4 top-4 z-10 rounded-full border-2 border-[hsl(var(--border))] bg-[hsl(var(--card))/0.95] p-2 text-[hsl(var(--muted-foreground))] shadow-md backdrop-blur-sm transition-all hover:border-primary/40 hover:bg-white hover:text-[hsl(var(--foreground))] hover:shadow-lg",
            isMobile && "right-3 top-3"
          )}>
            <X size={16} />
            <span className="sr-only">Tutup</span>
          </DialogClose>
        ) : null}

        {(title || description) && (
          <DialogHeader className={cn(
            "border-b border-border/60 bg-[hsl(var(--muted))/0.3] px-5 pb-4 text-left backdrop-blur-sm",
            isMobile ? "pt-2" : "pt-5 px-6",
          )}>
            {title ? (
              <DialogTitle className={cn(
                "font-[var(--font-display)] text-2xl font-bold text-[hsl(var(--foreground))]",
                !isMobile && "text-3xl"
              )}>
                {title}
              </DialogTitle>
            ) : null}
            {description ? (
              <DialogDescription className="mt-1.5 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
                {description}
              </DialogDescription>
            ) : null}
          </DialogHeader>
        )}

        <div
          className={cn(
            "px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:px-5",
            title || description ? "pt-3" : "pt-5",
            !isMobile && "max-h-[75vh] overflow-y-auto px-6 pb-6",
            isMobile && "max-h-[75vh] overflow-y-auto",
            bodyClassName
          )}
        >
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}
