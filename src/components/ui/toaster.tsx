"use client";

import { Toaster as Sonner } from "sonner";
import { useTheme } from "next-themes";

export function Toaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Sonner
      theme={(resolvedTheme as "light" | "dark") ?? "system"}
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: "!bg-surface !text-text !border-border !shadow-pop !rounded-lg",
          description: "!text-muted",
        },
      }}
    />
  );
}
