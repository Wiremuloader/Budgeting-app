"use client";

import { AlertTriangle } from "lucide-react";
import { Button, EmptyState } from "@/components/ui/primitives";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState
      icon={<AlertTriangle />}
      title="This page couldn't load"
      action={
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
      }
    >
      Your data is safe — nothing was changed. If this keeps happening, try again in a minute.
      {error.digest && <span className="mt-2 block font-mono text-xs">Reference: {error.digest}</span>}
    </EmptyState>
  );
}
