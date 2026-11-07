"use client";

import { MoreHorizontalIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { initials, shortDate } from "@/components/shell/format";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { leaveProfile, removeMember, setMemberRole } from "@/lib/actions/profiles";
import type { MemberRow } from "@/lib/data/workspace";

type Confirm = { kind: "remove"; member: MemberRow } | { kind: "leave" } | null;

/**
 * Members with their role. Owners can change roles and remove members; the
 * database refuses to remove or demote the last owner (PT409), and that
 * message is shown as is.
 */
export function MembersList({ profileId, members, me, myRole }: { profileId: string; members: MemberRow[]; me: string; myRole: "owner" | "member" }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const ownerCount = members.filter((m) => m.role === "owner").length;

  function changeRole(m: MemberRow, role: "owner" | "member") {
    setBusy(m.userId);
    startTransition(async () => {
      const res = await setMemberRole({ profileId, userId: m.userId, role });
      setBusy(null);
      if (!res.ok) {
        toast.error("Couldn't change the role", { description: res.error });
        return;
      }
      toast.success(`${m.fullName ?? m.email} is now ${role === "owner" ? "an owner" : "a member"}`);
    });
  }

  function remove(m: MemberRow) {
    setBusy(m.userId);
    startTransition(async () => {
      const res = await removeMember({ profileId, userId: m.userId });
      setBusy(null);
      setConfirm(null);
      if (!res.ok) {
        toast.error("Couldn't remove this member", { description: res.error });
        return;
      }
      toast.success(`${m.fullName ?? m.email} was removed`, { description: "Their connected accounts stop feeding this workspace." });
    });
  }

  function leave() {
    setBusy(me);
    startTransition(async () => {
      const res = await leaveProfile({ profileId });
      setBusy(null);
      setConfirm(null);
      if (!res.ok) {
        toast.error("Couldn't leave the workspace", { description: res.error });
        return;
      }
      router.push("/ads");
    });
  }

  return (
    <>
      <ul className="divide-y rounded-lg border">
        {members.map((m) => {
          const isMe = m.userId === me;
          const name = m.fullName?.trim() || null;
          const lastOwner = m.role === "owner" && ownerCount === 1;
          return (
            <li key={m.userId} className="flex items-center gap-3 p-3">
              <Avatar className="size-8">
                {m.avatarUrl ? <AvatarImage src={m.avatarUrl} alt="" /> : null}
                <AvatarFallback className="text-xs">{initials(name, m.email)}</AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="truncate text-sm font-medium">{name ?? m.email}</span>
                  {isMe ? <span className="text-xs text-muted-foreground">(you)</span> : null}
                  <Badge variant={m.role === "owner" ? "secondary" : "outline"}>{m.role === "owner" ? "Owner" : "Member"}</Badge>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {name ? `${m.email} · ` : ""}joined {shortDate(m.joinedAt)}
                </p>
              </div>
              {busy === m.userId ? <Spinner className="text-muted-foreground" /> : null}
              {myRole === "owner" || isMe ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${name ?? m.email}`} disabled={busy !== null}>
                      <MoreHorizontalIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {myRole === "owner" ? (
                      <>
                        {m.role === "member" ? (
                          <DropdownMenuItem onSelect={() => changeRole(m, "owner")}>Make owner</DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onSelect={() => changeRole(m, "member")} disabled={lastOwner}>
                            Make member
                          </DropdownMenuItem>
                        )}
                        {!isMe ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onSelect={() => setConfirm({ kind: "remove", member: m })} disabled={lastOwner}>
                              Remove from workspace
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </>
                    ) : null}
                    {isMe ? (
                      <>
                        {myRole === "owner" ? <DropdownMenuSeparator /> : null}
                        <DropdownMenuItem variant="destructive" onSelect={() => setConfirm({ kind: "leave" })} disabled={lastOwner}>
                          Leave workspace
                        </DropdownMenuItem>
                      </>
                    ) : null}
                    {lastOwner ? (
                      <p className="max-w-56 px-2 py-1.5 text-xs text-muted-foreground">
                        The last owner can&apos;t be removed or demoted. Make someone else an owner first.
                      </p>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </li>
          );
        })}
      </ul>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === "remove" ? `Remove ${confirm.member.fullName ?? confirm.member.email}?` : "Leave this workspace?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "remove"
                ? "They lose access right away. Accounts they connected stop feeding this workspace, and their decisions stay in the record."
                : "You lose access right away. Accounts you connected stop feeding this workspace. An owner can invite you back."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy !== null}
              onClick={(e) => {
                e.preventDefault();
                if (confirm?.kind === "remove") remove(confirm.member);
                else if (confirm?.kind === "leave") leave();
              }}
            >
              {busy ? <Spinner /> : null}
              {confirm?.kind === "remove" ? "Remove" : "Leave"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
