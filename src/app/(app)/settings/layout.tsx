import type { ReactNode } from "react";

import { SettingsNav } from "@/components/layout/settings-nav";
import { PageHeader } from "@/components/layout/page-header";

/** Settings frame: title + Members | Connected accounts | Workspace nav. Static; pages read the session. */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Settings" />
      <SettingsNav />
      <div className="flex flex-col gap-6 pt-1">{children}</div>
    </div>
  );
}
