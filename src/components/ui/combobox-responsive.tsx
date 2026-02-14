"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Plus, Search, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { cn } from "@/lib/utils";

export type ComboboxResponsiveOption = {
  value: string;
  label: string;
  subtitle?: string | null;
};

type ComboboxResponsiveProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value?: string;
  options: ComboboxResponsiveOption[];
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  loading?: boolean;
  foundText?: string;
  onCreateNew?: (name: string) => void;
  triggerClassName?: string;
};

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

export function ComboboxResponsive({
  open,
  onOpenChange,
  value,
  options,
  query,
  onQueryChange,
  onSelect,
  placeholder = "Pilih data",
  searchPlaceholder = "Cari...",
  emptyText = "Tidak ada data cocok.",
  loading = false,
  foundText,
  onCreateNew,
  triggerClassName,
}: ComboboxResponsiveProps) {
  const isMobile = useIsMobile();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const selected = options.find((item) => item.value === value);
  const resultsText = foundText ?? `${options.length} data ditemukan`;

  React.useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  const listContent = (
    <Command className="rounded-[20px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg">
      {/* Search Input dengan Icon */}
      <div className="relative border-b border-[hsl(var(--border))] bg-[hsl(var(--card))]">
        <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
        <CommandInput
          ref={inputRef}
          placeholder={searchPlaceholder}
          value={query}
          onValueChange={onQueryChange}
          className="h-14 pl-11 pr-4 text-base font-medium"
        />
      </div>
      
      {/* Results Counter */}
      <div className="flex items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[hsl(var(--primary))/0.15]">
            <User size={14} className="text-[hsl(var(--primary))]" />
          </div>
          <span className="text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
            {loading ? "Mencari..." : resultsText}
          </span>
        </div>
        {!loading && options.length > 0 && (
          <span className="rounded-full bg-[hsl(var(--primary))/0.12] px-3 py-1 text-[11px] font-bold text-[hsl(var(--primary))]">
            {options.length}
          </span>
        )}
      </div>
      
      {/* List Items */}
      <CommandList className="combobox-command-list bg-[hsl(var(--card))] p-3">
        {loading ? (
          <CommandEmpty>
            <div className="flex flex-col items-center gap-3 py-8">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary"></div>
              <p className="text-sm font-medium text-muted-foreground">Mencari peserta...</p>
            </div>
          </CommandEmpty>
        ) : (
          <>
            <CommandEmpty>
              <div className="flex flex-col items-center gap-4 bg-[hsl(var(--card))] py-10">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[hsl(var(--muted))/0.4]">
                  <User size={32} className="text-[hsl(var(--muted-foreground))/0.6]" />
                </div>
                <p className="text-base font-semibold text-[hsl(var(--muted-foreground))]">{emptyText}</p>
                {onCreateNew && query.trim().length > 0 ? (
                  <Button
                    variant="default"
                    size="sm"
                    className="mt-1 gap-2 shadow-md"
                    onClick={() => {
                      onCreateNew(query.trim());
                      onOpenChange(false);
                    }}
                  >
                    <Plus size={16} />
                    Tambah "{query.trim()}"
                  </Button>
                ) : null}
              </div>
            </CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.label}
                  className="combobox-item group mb-2 cursor-pointer rounded-xl border border-[hsl(var(--border))/0.3] bg-[hsl(var(--card))] px-4 py-3.5 transition-all hover:border-[hsl(var(--primary))/0.3] hover:bg-[hsl(var(--primary))/0.06] hover:shadow-sm active:scale-[0.98]"
                  onSelect={() => {
                    onSelect(option.value);
                    onOpenChange(false);
                  }}
                >
                  <div className="flex items-center gap-3.5">
                    <div className={cn(
                      "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full transition-all",
                      value === option.value 
                        ? "bg-[hsl(var(--primary))] shadow-md" 
                        : "bg-[hsl(var(--muted))/0.6] group-hover:bg-[hsl(var(--primary))/0.15]"
                    )}>
                      {value === option.value ? (
                        <Check className="h-5 w-5 text-white" />
                      ) : (
                        <User size={18} className="text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--primary))]" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={cn(
                        "truncate text-base font-bold leading-tight transition-colors",
                        value === option.value 
                          ? "text-[hsl(var(--primary))]" 
                          : "text-[hsl(var(--foreground))] group-hover:text-[hsl(var(--primary))]"
                      )}>
                        {option.label}
                      </p>
                      {option.subtitle ? (
                        <p className="mt-0.5 line-clamp-1 text-xs leading-tight text-[hsl(var(--muted-foreground))]">
                          📍 {option.subtitle}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </Command>
  );

  const trigger = (
    <Button
      type="button"
      variant="outline"
      className={cn(
        "h-14 w-full justify-between gap-3 rounded-2xl border-2 bg-[hsl(var(--card))] px-4 font-semibold shadow-sm transition-all hover:border-primary/40 hover:bg-[hsl(var(--muted))/0.1] hover:shadow-md",
        open && "border-primary/60 bg-[hsl(var(--muted))/0.15] shadow-md",
        triggerClassName
      )}
      aria-expanded={open}
      onClick={isMobile ? () => onOpenChange(true) : undefined}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <div className={cn(
          "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-all",
          selected ? "bg-gradient-to-br from-primary/20 to-primary/10" : "bg-muted/60"
        )}>
          <User size={16} className={selected ? "text-primary" : "text-muted-foreground"} />
        </div>
        <span className={cn(
          "truncate text-left text-base",
          selected ? "text-foreground" : "text-muted-foreground"
        )}>
          {selected?.label ?? placeholder}
        </span>
      </div>
      <ChevronsUpDown className={cn(
        "h-5 w-5 flex-shrink-0 transition-transform",
        open && "rotate-180 text-primary"
      )} />
    </Button>
  );

  if (isMobile) {
    return (
      <>
        {trigger}
        <ResponsiveDialog
          open={open}
          onOpenChange={onOpenChange}
          title="Pilih Peserta"
          description="Cari dan pilih peserta untuk mencatat presensi kajian hari ini."
          contentClassName="max-w-none"
          bodyClassName="p-0"
        >
          {listContent}
        </ResponsiveDialog>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange} modal>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="popover-content p-2">
        {listContent}
      </PopoverContent>
    </Popover>
  );
}
