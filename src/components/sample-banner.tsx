import Link from "next/link";
import { FlaskConical } from "lucide-react";

export function SampleBanner() {
  return (
    <div role="note" className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-dashed border-warning/60 bg-warning-soft px-4 py-2.5 text-[13px] text-text-2">
      <FlaskConical className="size-4 text-warning" aria-hidden />
      <span>
        <strong className="font-semibold text-text">Sample data.</strong> Accounts marked as demo data are made up for exploring Ledger — they aren’t connected to any bank.
      </span>
      <Link href="/settings?tab=data" className="ml-auto font-medium text-accent hover:underline">
        Remove sample data
      </Link>
    </div>
  );
}
