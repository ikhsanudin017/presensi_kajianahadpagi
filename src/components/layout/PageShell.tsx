"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PageShellProps = {
  eyebrow?: string;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
};

export function PageShell({
  eyebrow,
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: PageShellProps) {
  return (
    <section className={cn("site-main-card p-4 sm:p-5 lg:p-7", className)}>
      {(eyebrow || title || description || actions) && (
        <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            {eyebrow ? <p className="site-label">{eyebrow}</p> : null}
            {title ? (
              <h2 className="site-title text-balance text-2xl leading-tight text-[hsl(var(--foreground))] sm:text-3xl">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="max-w-3xl text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? <div className="w-full shrink-0 lg:w-auto">{actions}</div> : null}
        </header>
      )}

      <div className={cn(title || description || eyebrow || actions ? "mt-5 sm:mt-6" : "", bodyClassName)}>
        {children}
      </div>
    </section>
  );
}
