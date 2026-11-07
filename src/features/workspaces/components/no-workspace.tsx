import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CurrentUser } from "@/features/auth/server/dal";
import type { PendingInvitation } from "@/features/workspaces/server/queries";

import { NewWorkspaceForm, PendingInvitationsList } from "./new-workspace-form";
import { Wordmark } from "@/components/layout/wordmark";

/**
 * Shown instead of the app when the signed-in user belongs to no workspace:
 * pending invitations first (one click to join), then "create your own".
 */
export function NoWorkspace({ user, invitations }: { user: CurrentUser; invitations: PendingInvitation[] }) {
  const hasInvites = invitations.length > 0;
  return (
    <main className="flex min-h-svh w-full flex-1 flex-col items-center justify-center gap-6 bg-muted/30 px-4 py-8">
      <Wordmark size="md" />
      <div className="flex w-full max-w-md flex-col gap-4">
        {hasInvites ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">You&apos;ve been invited</CardTitle>
              <CardDescription>Accept to join the workspace. You can also create your own below.</CardDescription>
            </CardHeader>
            <CardContent>
              <PendingInvitationsList invitations={invitations} />
            </CardContent>
          </Card>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{hasInvites ? "Or create a workspace" : "Create your workspace"}</CardTitle>
            <CardDescription>
              {hasInvites
                ? "A workspace holds your team's ads, rules and product terms."
                : "You're signed in, but you don't belong to a workspace yet. Create one, or ask a teammate for an invitation link."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <NewWorkspaceForm autoFocus={!hasInvites} />
          </CardContent>
        </Card>
        <form method="post" action="/auth/signout" className="flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
          <span className="truncate">Signed in as {user.email ?? "you"}</span>
          <Button type="submit" variant="link" size="sm" className="h-auto px-0 text-xs">
            Sign out
          </Button>
        </form>
      </div>
    </main>
  );
}
