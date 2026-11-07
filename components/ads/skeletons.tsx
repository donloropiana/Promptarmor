import { Skeleton } from "@/components/ui/skeleton";

export function AdsListSkeleton() {
  return (
    <div className="flex flex-col" aria-busy="true" aria-label="Loading ads">
      <Skeleton className="h-12 w-full rounded-xl" />
      <div className="mt-5 flex items-center gap-3">
        <Skeleton className="h-4 w-56" />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
      <div className="mt-6 flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-28 rounded-md" />
        ))}
      </div>
      <div className="mt-3 divide-y rounded-xl border">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-3">
            <Skeleton className="size-16 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3.5 w-5/6" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AdPageSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy="true" aria-label="Loading ad">
      <div className="flex items-center gap-3 pb-3">
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-5 w-64" />
        <Skeleton className="ml-auto h-6 w-24 rounded-full" />
      </div>
      <div className="grid flex-1 gap-0 rounded-xl border md:grid-cols-[55%_45%]">
        <div className="space-y-3 p-4 sm:p-6">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="mt-6 h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
        <div className="space-y-3 border-t p-4 md:border-t-0 md:border-l sm:p-6">
          <Skeleton className="h-4 w-32" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
