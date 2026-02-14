"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { useToast } from "@/components/ui/use-toast";
import { safeJson } from "@/lib/http";

const STORAGE_KEY = "alirsyad_authed";

export function PinGate({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [pin, setPin] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const { showToast } = useToast();

  React.useEffect(() => {
    const authed = localStorage.getItem(STORAGE_KEY);
    if (authed === "true") {
      setOpen(false);
      return;
    }
    fetch("/api/pin")
      .then((res) => safeJson<{ enabled?: boolean }>(res))
      .then((data) => {
        const enabled = data?.enabled;
        if (typeof enabled !== "boolean") {
          setOpen(true);
          return;
        }
        if (!enabled) {
          localStorage.setItem(STORAGE_KEY, "true");
          setOpen(false);
        } else {
          setOpen(true);
        }
      })
      .catch(() => setOpen(true));
  }, []);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await safeJson<{ ok?: boolean }>(res);
      if (data?.ok) {
        localStorage.setItem(STORAGE_KEY, "true");
        setOpen(false);
        showToast({ title: "PIN valid", description: "Akses terbuka untuk device ini." });
      } else {
        showToast({ title: "PIN salah", description: "Coba lagi.", variant: "warning" });
      }
    } catch (error) {
      console.error(error);
      showToast({ title: "Gagal verifikasi", description: "Cek koneksi dan coba lagi." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {children}
      <ResponsiveDialog
        open={open}
        onOpenChange={() => {}}
        title="Masukkan PIN"
        description="Untuk mencegah input iseng. PIN hanya diminta sekali per device."
        hideCloseButton
      >
        <div className="space-y-3">
          <Input
            type="password"
            placeholder="PIN"
            value={pin}
            onChange={(event) => setPin(event.target.value)}
          />
          <Button onClick={handleSubmit} disabled={loading || pin.length === 0} className="w-full">
            {loading ? "Memeriksa..." : "Masuk"}
          </Button>
        </div>
      </ResponsiveDialog>
    </>
  );
}
