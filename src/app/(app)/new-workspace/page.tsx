import type { Metadata } from "next";

import { NewWorkspaceForm } from "@/features/workspaces/components/new-workspace-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "New workspace · Marketing Compliance Workbench" };
// Reads the session (see src/app/(app)/layout.tsx), so it blocks on the server by design.
export const instant = false;

/**
 * Creating another workspace while already in one. (Users with no workspace
 * see the create screen from the layout gate on every route, including this
 * one, so this page never needs to check that case.)
 */
export default function NewWorkspacePage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="New workspace"
        description="A separate workspace with its own ads, rules, product terms and members. You can create up to 3."
      />
      <Card className="max-w-md">
        <CardContent>
          <NewWorkspaceForm autoFocus />
        </CardContent>
      </Card>
    </div>
  );
}
