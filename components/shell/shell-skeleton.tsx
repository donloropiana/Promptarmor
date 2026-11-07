import { Skeleton } from "@/components/ui/skeleton";

/** Suspense fallback with the same footprint as AppShell (sidebar + page). */
export function ShellSkeleton() {
  return (
    <div className="flex min-h-svh w-full" aria-busy="true" aria-label="Loading">
      <aside className="hidden w-64 shrink-0 flex-col gap-4 border-r bg-sidebar p-2 md:flex">
        <Skeleton className="h-10 w-full" />
        <div className="flex flex-col gap-1 px-1">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
        <Skeleton className="mt-auto h-10 w-full" />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 items-center gap-2 border-b px-3 md:hidden">
          <Skeleton className="size-7" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="mx-auto w-full max-w-5xl px-4 py-4 md:px-6 md:py-6">
          <PageSkeleton />
        </div>
      </div>
    </div>
  );
}

/** Generic page body placeholder: a title line and a few rows. */
export function PageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    </div>
  );
}
