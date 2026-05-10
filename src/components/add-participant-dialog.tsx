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
      description="Nama wajib diisi. Alamat dan jenis kelamin boleh dikosongkan."
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Nama</Label>
          <Input
            id="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Contoh: Ahmad Fauzi"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="address">Alamat</Label>
          <Input
            id="address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="Opsional"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="gender">Jenis Kelamin</Label>
          <select
            id="gender"
            className="site-select w-full"
            value={gender}
            onChange={(event) => setGender(event.target.value as "L" | "P" | "")}
          >
            <option value="">Belum diketahui</option>
            <option value="L">Laki-laki</option>
            <option value="P">Perempuan</option>
          </select>
        </div>
        <Button className="h-12 w-full" onClick={submit} disabled={loading}>
          {loading ? "Menyimpan..." : "Simpan"}
        </Button>
      </div>
    </ResponsiveDialog>
  );
}
