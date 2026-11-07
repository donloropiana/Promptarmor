import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ShellSkeleton } from "@/components/layout/shell-skeleton";
import { getCurrentUser } from "@/features/auth/server/dal";

/** "/" has no content of its own: signed in -> the Ads list, else sign-in. */
export default function Home() {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <HomeRedirect />
    </Suspense>
  );
}

async function HomeRedirect() {
  const user = await getCurrentUser();
  redirect(user ? "/ads" : "/signin");
  return null;
}
