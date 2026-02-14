"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { safeJson } from "@/lib/http";

type Props = {
  open: boolean;
  initialName?: string;
  onOpenChange: (open: boolean) => void;
  onCreated: (participant: { id: string; name: string; address?: string | null; gender?: "L" | "P" | null }) => void;
};

export function AddParticipantDialog({ open, initialName, onOpenChange, onCreated }: Props) {
  const [name, setName] = React.useState(initialName ?? "");
  const [address, setAddress] = React.useState("");
  const [gender, setGender] = React.useState<"L" | "P" | "">("");
  const [loading, setLoading] = React.useState(false);
  const { showToast } = useToast();

  React.useEffect(() => {
    if (open) {
      setName(initialName ?? "");
      setAddress("");
      setGender("");
    }
  }, [open, initialName]);

  const submit = async () => {
    if (!name.trim()) {
      showToast({ title: "Nama wajib diisi" });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/participants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          address: address.trim() || undefined,
          gender: gender || undefined,
        }),
      });
      const data = await safeJson<{
        ok?: boolean;
        data?: { id: string; name: string; address?: string | null; gender?: "L" | "P" | null };
        warning?: string | null;
      }>(res);
      if (!data?.ok) {
        showToast({ title: "Gagal menambah peserta" });
        return;
      }
      if (data.data) {
        onCreated(data.data);
      }
      onOpenChange(false);
      showToast({
        title: "Peserta baru ditambahkan",
        description: data.warning ? "Sync ke sheet gagal, data tersimpan di DB." : undefined,
      });
    } catch (error) {
      console.error(error);
      showToast({ title: "Gagal menambah peserta" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Tambah Peserta Baru"
      description="Lengkapi data peserta jika tersedia."
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Nama</Label>
          <Input id="name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="address">Alamat</Label>
          <Input id="address" value={address} onChange={(event) => setAddress(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="gender">Gender (L/P)</Label>
          <Input
            id="gender"
            value={gender}
            maxLength={1}
            onChange={(event) => setGender(event.target.value.toUpperCase() as "L" | "P" | "")}
          />
        </div>
        <Button className="w-full" onClick={submit} disabled={loading}>
          {loading ? "Menyimpan..." : "Simpan"}
        </Button>
      </div>
    </ResponsiveDialog>
  );
}
