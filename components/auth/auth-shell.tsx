import type { ReactNode } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Centered card used by sign-in, confirm, invite and reset-password pages. */
export function AuthShell({
  brand,
  title,
  description,
  children,
  footer,
}: {
  /** Small wordmark shown above the card (sign-in only). */
  brand?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-svh w-full flex-1 flex-col items-center justify-center gap-5 bg-muted/30 px-4 py-6">
      {brand ? <div className="flex justify-center">{brand}</div> : null}
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        {children ? <CardContent className="flex flex-col gap-4">{children}</CardContent> : null}
        {footer ? <CardFooter className="border-t py-3 text-xs text-muted-foreground">{footer}</CardFooter> : null}
      </Card>
    </main>
  );
}

/** Suspense fallback with the same footprint as AuthShell. */
export function AuthShellSkeleton() {
  return (
    <main className="flex min-h-svh w-full flex-1 items-center justify-center bg-muted/30 px-4 py-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-56" />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>
    </main>
  );
}
