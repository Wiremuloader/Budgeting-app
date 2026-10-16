import { Skeleton } from "@/components/ui/primitives";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-2 h-10 w-full max-w-56" />
      <Skeleton className="mb-8 h-4 w-full max-w-80" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-72 lg:col-span-2" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}
