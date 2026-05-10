"use client";

import * as React from "react";
import { ComboboxResponsive, type ComboboxResponsiveOption } from "@/components/ui/combobox-responsive";
import { safeJson } from "@/lib/http";

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
      setQuery("");
      return;
    }

    const handler = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/participants?q=${encodeURIComponent(query)}`, { cache: "no-store" });
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

  const options = React.useMemo<ComboboxResponsiveOption[]>(
    () => {
      const source =
        value && !items.some((participant) => participant.id === value.id)
          ? [value, ...items]
          : items;

      return source.map((participant) => ({
        value: participant.id,
        label: participant.name,
        subtitle: participant.address ?? undefined,
      }));
    },
    [items, value]
  );

  return (
    <ComboboxResponsive
      open={open}
      onOpenChange={setOpen}
      value={value?.id}
      options={options}
      query={query}
      onQueryChange={setQuery}
      onSelect={(id) => {
        const participant = items.find((item) => item.id === id) ?? (value?.id === id ? value : null);
        if (participant) onSelect(participant);
      }}
      placeholder="Pilih peserta"
      searchPlaceholder="Cari nama peserta..."
      emptyText="Nama tidak ditemukan."
      loading={loading}
      foundText={`${items.length} peserta ditemukan`}
      onCreateNew={onCreateNew}
    />
  );
}
