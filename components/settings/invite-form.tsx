"use client";

import { UserPlusIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { inviteMember, type InviteResult } from "@/lib/actions/profiles";

import { InviteLinkDialog } from "./invite-link-dialog";

/** Owner-only: invite by email, then show the link to copy. */
export function InviteForm({ profileId }: { profileId: string }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "owner">("member");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InviteResult | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await inviteMember({ profileId, email, role });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult(res.data);
      setEmail("");
      setRole("member");
    });
  }

  return (
    <>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field className="flex-1">
            <FieldLabel htmlFor="invite-email">Email</FieldLabel>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="off"
              spellCheck={false}
              placeholder="teammate@company.com"
            />
          </Field>
          <Field className="sm:w-36">
            <FieldLabel htmlFor="invite-role">Role</FieldLabel>
            <Select value={role} onValueChange={(v) => setRole(v === "owner" ? "owner" : "member")}>
              <SelectTrigger id="invite-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="owner">Owner</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Button type="submit" disabled={pending} className="sm:mb-0">
            {pending ? <Spinner /> : <UserPlusIcon />}
            Invite
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          You get a link to send. Members can review and approve ads; owners can also manage members and workspace settings.
        </p>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </form>
      {result ? (
        <InviteLinkDialog
          open
          onOpenChange={(open) => {
            if (!open) setResult(null);
          }}
          email={result.email}
          inviteUrl={result.inviteUrl}
        />
      ) : null}
    </>
  );
}
