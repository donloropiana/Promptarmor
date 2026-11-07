import { redirect } from "next/navigation";

// Sits under the session gate (app/(app)/layout.tsx), so it blocks on the server by design.
export const instant = false;

/** /settings has no content of its own. */
export default function SettingsIndex() {
  redirect("/settings/members");
}
