"use client";

import * as React from "react";

const DEVICE_KEY = "alirsyad_device_id";

export function useDeviceId() {
  const [deviceId, setDeviceId] = React.useState<string>("");

  React.useEffect(() => {
    const stored = localStorage.getItem(DEVICE_KEY);
    if (stored) {
      setDeviceId(stored);
      return;
    }
    const created = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, created);
    setDeviceId(created);
  }, []);

  return deviceId;
}
