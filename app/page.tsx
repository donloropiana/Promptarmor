import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ShellSkeleton } from "@/components/shell/shell-skeleton";
import { getCurrentUser } from "@/lib/auth/dal";

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
