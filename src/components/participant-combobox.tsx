"use client";

import * as React from "react";
import { ChevronsUpDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { safeJson } from "@/lib/http";
import { cn } from "@/lib/utils";

export type Participant = {
  id: string;
  name: string;
  address?: string | null;
  gender?: "L" | "P" | null;
};

type Props = {
  value?: Participant | null;
  onSelect: (participant: Participant) => void;
  onCreateNew: (name: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function ParticipantCombobox({ value, onSelect, onCreateNew, open: openProp, onOpenChange }: Props) {
  const [openState, setOpenState] = React.useState(false);
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  const [query, setQuery] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [items, setItems] = React.useState<Participant[]>([]);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    const handler = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/participants?q=${encodeURIComponent(query)}`);
        const data = await safeJson<{ data?: Participant[] }>(res);
        setItems(data?.data ?? []);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(handler);
  }, [open, query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-between">
          {value ? value.name : "Pilih peserta"}
          <ChevronsUpDown className="h-4 w-4 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(380px,90vw)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Cari nama peserta..." value={query} onValueChange={setQuery} />
          <CommandList>
            {loading ? (
              <CommandEmpty>Mencari...</CommandEmpty>
            ) : (
              <>
                <CommandEmpty>
                  Tidak ada nama cocok.
                  {query.length > 0 ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-3 w-full"
                      onClick={() => {
                        onCreateNew(query);
                        setOpen(false);
                      }}
                    >
                      Tambah Nama Baru
                    </Button>
                  ) : null}
                </CommandEmpty>
                <CommandGroup>
                  {items.map((participant) => (
                    <CommandItem
                      key={participant.id}
                      value={participant.name}
                      onSelect={() => {
                        onSelect(participant);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "h-4 w-4 text-[hsl(var(--primary))]",
                          value?.id === participant.id ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <div>
                        <div className="font-medium">{participant.name}</div>
                        {participant.address ? (
                          <div className="text-xs text-[hsl(var(--muted-foreground))]">
                            {participant.address}
                          </div>
                        ) : null}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
