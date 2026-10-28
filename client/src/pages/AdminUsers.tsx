import UserMenu from "@/components/UserMenu";
import AccessActivity from "@/components/admin/AccessActivity";
import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { trpc } from "@/lib/trpc";
import { formatDate } from "@/lib/utils";
import { ArrowLeft, Check, Loader2, MailX, Send, Trash2, UserRound, MoreHorizontal, Pencil, Shield } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { toast } from "sonner";

type Role = "admin" | "team_lead" | "staff" | "viewer";

const ROLES: Role[] = ["admin", "team_lead", "staff", "viewer"];
const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  team_lead: "Team Lead",
  staff: "Staff",
  viewer: "View only",
};

function SectionCard({
  title,
  description,
  count,
  children,
}: {
  title: string;
  description: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <Card className="gap-0 overflow-hidden rounded-2xl border-slate-200/80 bg-white py-0 shadow-[0_12px_40px_-24px_rgba(15,23,42,0.35)]">
      <CardHeader className="border-b border-slate-100 px-5 py-5 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base font-bold text-slate-900">{title}</CardTitle>
            <CardDescription className="mt-1 leading-relaxed">{description}</CardDescription>
          </div>
          {count !== undefined && (
            <Badge variant="secondary" className="rounded-full bg-slate-100 px-2.5 text-slate-600">
              {count}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  );
}

function LoadingRows({ columns }: { columns: number }) {
  return (
    <>
      {[0, 1, 2].map((row) => (
        <TableRow key={row} className="hover:bg-transparent">
          {Array.from({ length: columns }).map((_, column) => (
            <TableCell key={column} className="h-[68px] px-5">
              <div className="h-3.5 animate-pulse rounded-full bg-slate-100" style={{ width: `${55 + ((row + column) % 3) * 15}%` }} />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

function EmptyRow({ columns, message }: { columns: number; message: string }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={columns} className="h-28 text-center text-sm text-slate-500">
        {message}
      </TableCell>
    </TableRow>
  );
}

function ErrorRow({ columns, message }: { columns: number; message: string }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={columns} className="h-28 bg-rose-50/40 text-center text-sm text-rose-700">
        {message}
      </TableCell>
    </TableRow>
  );
}

export default function AdminUsers() {
  const { user: currentUser, refresh: refreshCurrentUser } = useAuth();
  const utils = trpc.useUtils();
  const usersQuery = trpc.admin.listUsers.useQuery();
  const therapistsQuery = trpc.therapists.list.useQuery();
  const teamsQuery = trpc.teams.list.useQuery();
  const invitesQuery = trpc.admin.listInvites.useQuery();
  const sessionsQuery = trpc.admin.listSessions.useQuery();
  const auditQuery = trpc.admin.auditLog.useQuery({ limit: 100 });

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("staff");
  const [inviteToRevoke, setInviteToRevoke] = useState<{ id: number; email: string } | null>(null);
  const [accountToDelete, setAccountToDelete] = useState<{ id: number; label: string } | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [nameDrafts, setNameDrafts] = useState<Record<number, string>>({});

  const invalidateAll = () => {
    utils.admin.listUsers.invalidate();
    utils.admin.listInvites.invalidate();
    utils.admin.listSessions.invalidate();
    utils.admin.auditLog.invalidate();
    utils.therapists.list.invalidate();
    utils.teams.list.invalidate();
  };

  const showInviteDelivery = (email: string, delivery: string, resent = false) => {
    if (delivery === "sent") {
      toast.success(`${resent ? "New invitation sent" : "Invitation sent"} to ${email}`);
    } else if (delivery === "not_configured") {
      toast.warning(`Invite saved for ${email}, but email is not configured on the server.`);
    } else if (delivery === "rate_limited") {
      toast.warning(`Too many links were requested. Wait 15 minutes before resending to ${email}.`);
    } else {
      toast.error(`Invite saved, but the email could not be delivered to ${email}. Check the server email settings.`);
    }
  };

  const invite = trpc.admin.invite.useMutation({
    onSuccess: (result) => {
      showInviteDelivery(result.email, result.emailDelivery);
      setInviteEmail("");
      setInviteName("");
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteUser = trpc.admin.deleteUser.useMutation({
    onSuccess: () => {
      toast.success("Account permanently deleted");
      setAccountToDelete(null);
      setDeleteConfirmation("");
      invalidateAll();
      utils.directMessages.invalidate();
      utils.messageBoard.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const updateUserRole = trpc.admin.updateUserRole.useMutation({
    onSuccess: invalidateAll,
    onError: (e) => toast.error(e.message),
  });

  const updateUserName = trpc.admin.updateUserName.useMutation({
    onSuccess: async (_result, variables) => {
      toast.success("Account holder name updated");
      setEditingUserId(null);
      setNameDrafts((current) => {
        const next = { ...current };
        delete next[variables.userId];
        return next;
      });
      await utils.admin.listUsers.invalidate();
      if (variables.userId === currentUser?.id) await refreshCurrentUser();
    },
    onError: (error) => toast.error(error.message),
  });

  const linkUserToTherapist = trpc.admin.linkUserToTherapist.useMutation({
    onSuccess: () => {
      toast.success("Account access scope updated");
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateInviteRole = trpc.admin.updateInviteRole.useMutation({
    onSuccess: () => {
      toast.success("Pending invite role updated");
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const revokeInvite = trpc.admin.revokeInvite.useMutation({
    onSuccess: () => {
      toast.success(`Invite for ${inviteToRevoke?.email ?? "that email"} revoked`);
      setInviteToRevoke(null);
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const resendInvite = trpc.admin.resendInvite.useMutation({
    onSuccess: (result, variables) => {
      showInviteDelivery(variables.email, result.emailDelivery, true);
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const setDeactivated = trpc.admin.setUserDeactivated.useMutation({
    onSuccess: invalidateAll,
    onError: (e) => toast.error(e.message),
  });

  const revokeSession = trpc.admin.revokeSession.useMutation({
    onSuccess: () => {
      toast.success("Device signed out");
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const users = usersQuery.data ?? [];
  const therapists = therapistsQuery.data ?? [];
  const teams = teamsQuery.data ?? [];
  const pendingInvites = (invitesQuery.data ?? []).filter((item) => !item.acceptedAt);
  const sessions = sessionsQuery.data ?? [];
  const auditEntries = auditQuery.data ?? [];
  const activeUserCount = users.filter((user) => !user.deactivatedAt).length;
  const hasQueryError = usersQuery.isError || invitesQuery.isError || sessionsQuery.isError || auditQuery.isError;

  const retryQueries = () => {
    void Promise.all([
      usersQuery.refetch(),
      invitesQuery.refetch(),
      sessionsQuery.refetch(),
      auditQuery.refetch(),
    ]);
  };

  const handleInvite = (event: React.FormEvent) => {
    event.preventDefault();
    const email = inviteEmail.trim();
    if (!email) return;
    invite.mutate({ email, role: inviteRole, name: inviteName.trim() });
  };

  return (
    <main className="min-h-screen bg-slate-50/70 pb-16">
      <header className="relative overflow-hidden bg-gradient-to-r from-blue-800 via-sky-700 to-blue-800 text-white shadow-lg shadow-blue-950/10">
        <div aria-hidden className="absolute -left-24 -top-32 h-80 w-80 rounded-full bg-sky-300/10 blur-3xl" />
        <div aria-hidden className="absolute -right-20 top-0 h-72 w-72 rounded-full bg-blue-400/15 blur-3xl" />

        <div className="relative mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
          <nav className="flex items-center justify-between gap-4" aria-label="Admin navigation">
            <Link
              href="/board"
              className="group inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold text-blue-100 transition-colors hover:bg-white/10 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
              Back to board
            </Link>
            <UserMenu inline />
          </nav>

          <div className="mt-9 pb-7">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-sky-200">Admin console</p>
              <h1 className="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl">Manage user access</h1>
              <p className="mt-1 max-w-2xl text-sm text-blue-100/80">
                Invite teammates, assign permissions, and review account activity from one place.
              </p>
              <nav aria-label="Activity shortcuts" className="mt-5 flex flex-wrap gap-2">
                <a href="#signed-in-devices" className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Signed-in devices ↓</a>
                <a href="#audit-log" className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Audit log ↓</a>
              </nav>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pt-6 sm:px-6 lg:px-8">
        {hasQueryError && (
          <div role="alert" className="flex flex-col gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-900 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">Some admin data could not be loaded.</p>
              <p className="mt-0.5 text-sm text-rose-700">Your existing data is unchanged. Check the connection and try again.</p>
            </div>
            <Button type="button" variant="outline" size="sm" className="border-rose-200 bg-white text-rose-700 hover:bg-rose-100" onClick={retryQueries}>
              Try again
            </Button>
          </div>
        )}

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Access overview">
          {[
            { label: "Active users", value: usersQuery.isLoading || usersQuery.isError ? "—" : activeUserCount },
            { label: "Pending invites", value: invitesQuery.isLoading || invitesQuery.isError ? "—" : pendingInvites.length },
            { label: "Signed-in devices", value: sessionsQuery.isLoading || sessionsQuery.isError ? "—" : sessions.length },
            { label: "Recent audit events", value: auditQuery.isLoading || auditQuery.isError ? "—" : auditEntries.length },
          ].map(({ label, value }) => (
            <Card key={label} className="gap-0 rounded-2xl border-slate-200/80 bg-white p-4 shadow-sm sm:p-5">
              <p className="text-2xl font-black tracking-tight text-slate-900">{value}</p>
              <p className="mt-1 text-xs font-semibold text-slate-500 sm:text-sm">{label}</p>
            </Card>
          ))}
        </section>

        <Card className="relative gap-0 overflow-hidden rounded-2xl border-sky-200/80 bg-gradient-to-br from-white via-white to-sky-50 py-0 shadow-[0_16px_50px_-28px_rgba(2,132,199,0.45)]">
          <div aria-hidden className="absolute -right-16 -top-20 h-52 w-52 rounded-full bg-sky-200/30 blur-3xl" />
          <div className="relative grid gap-5 p-5 md:grid-cols-[minmax(220px,0.7fr)_minmax(0,1.3fr)] md:items-center md:p-6">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Invite a teammate</h2>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">Choose their access level. Names are optional; teammates can add their own in the account menu. Team leads can access all teams’ schedules.</p>
            </div>

            <form onSubmit={handleInvite} className="grid gap-2.5 sm:grid-cols-2">
              <div className="relative">
                <Input
                  type="email"
                  aria-label="Teammate email"
                  placeholder="name@hospital.org"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  className="h-11 rounded-xl border-slate-200 bg-white shadow-sm focus-visible:border-sky-400 focus-visible:ring-sky-200"
                />
              </div>
              <Input aria-label="Teammate name (optional)" placeholder="Name (optional)" maxLength={80}
                value={inviteName} onChange={(event) => setInviteName(event.target.value)}
                className="h-11 rounded-xl border-slate-200 bg-white" />
              <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as Role)}>
                <SelectTrigger aria-label="Invite role" className="h-11 w-full rounded-xl border-slate-200 bg-white shadow-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((role) => (
                    <SelectItem key={role} value={role}>{ROLE_LABELS[role]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="submit"
                disabled={!inviteEmail.trim() || invite.isPending}
                className="h-11 rounded-xl bg-sky-600 px-5 font-semibold shadow-md shadow-sky-600/20 hover:bg-sky-500"
              >
                {invite.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {invite.isPending ? "Sending" : "Send invite"}
              </Button>
            </form>
          </div>
        </Card>

        <SectionCard
          title="Team members"
          description="Manage account names, roles, and schedule access."
          count={users.length}
        >
          <div
            className="hidden grid-cols-[minmax(0,1.6fr)_132px_minmax(0,1.4fr)_145px_36px] items-center gap-5 border-b border-slate-100 bg-slate-50/70 px-6 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 lg:grid"
            aria-hidden="true"
          >
            <span>Member</span>
            <span>Role</span>
            <span>Schedule access</span>
            <span>Account activity</span>
            <span />
          </div>
          {usersQuery.isError ? (
            <p
              role="alert"
              className="px-6 py-10 text-center text-sm text-rose-700"
            >
              Team members could not be loaded.
            </p>
          ) : usersQuery.isLoading ? (
            <div
              className="space-y-5 px-6 py-6"
              role="status"
              aria-label="Loading team members"
            >
              {[0, 1, 2].map((row) => (
                <div
                  key={row}
                  className="h-14 animate-pulse rounded-lg bg-slate-100"
                />
              ))}
            </div>
          ) : users.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-slate-500">
              No users have joined yet.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100" aria-label="Team members">
              {users.map((user) => {
                const isCurrentUser = user.id === currentUser?.id;
                const isOtherAdmin = user.role === "admin" && !isCurrentUser;
                const identity = isOtherAdmin
                  ? "Admin"
                  : user.email || user.name || user.openId;
                const accessNeedsSetup =
                  user.role !== "admin" &&
                  user.role !== "team_lead" &&
                  user.therapistId == null;
                const draftName = nameDrafts[user.id] ?? user.name ?? "";
                const trimmedName = draftName.trim();
                const canSaveName = trimmedName !== (user.name ?? "").trim();
                const isSavingName =
                  updateUserName.isPending &&
                  updateUserName.variables?.userId === user.id;
                const isEditingName = editingUserId === user.id;
                const cancelNameEdit = () => {
                  setEditingUserId(null);
                  setNameDrafts((current) => {
                    const next = { ...current };
                    delete next[user.id];
                    return next;
                  });
                };
                return (
                  <li
                    key={user.id}
                    className="relative grid min-w-0 grid-cols-1 items-start gap-x-5 gap-y-4 px-5 py-5 transition-colors hover:bg-slate-50/60 sm:grid-cols-2 sm:px-6 lg:grid-cols-[minmax(0,1.6fr)_132px_minmax(0,1.4fr)_145px_36px]"
                  >
                    <div className="flex min-w-0 items-start gap-3 pr-10 sm:col-span-2 lg:col-span-1 lg:pr-0">
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ring-1 ring-inset ${user.deactivatedAt ? "bg-slate-100 text-slate-500 ring-slate-200" : "bg-sky-50 text-sky-700 ring-sky-100"}`}
                        aria-hidden="true"
                      >
                        {isOtherAdmin ? (
                          <Shield className="h-4 w-4" />
                        ) : (
                          (user.name || user.email || "?").charAt(0).toUpperCase()
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        {isOtherAdmin ? (
                          <>
                            <p className="text-sm font-semibold text-slate-900">
                              Admin
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              Identity hidden
                            </p>
                          </>
                        ) : isEditingName ? (
                          <form
                            onSubmit={(event) => {
                              event.preventDefault();
                              if (canSaveName && !updateUserName.isPending)
                                updateUserName.mutate({
                                  userId: user.id,
                                  name: trimmedName,
                                });
                            }}
                            className="space-y-2"
                          >
                            <Input
                              autoFocus
                              value={draftName}
                              maxLength={80}
                              disabled={isSavingName}
                              onChange={(event) =>
                                setNameDrafts((current) => ({
                                  ...current,
                                  [user.id]: event.target.value,
                                }))
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Escape" && !isSavingName)
                                  cancelNameEdit();
                              }}
                              aria-label={`Account holder name for ${identity}`}
                              placeholder="Name (optional)"
                              className="h-9 w-full rounded-lg border-sky-300 bg-white text-sm"
                            />
                            <div className="flex items-center gap-2">
                              <Button
                                type="submit"
                                size="sm"
                                disabled={updateUserName.isPending || !canSaveName}
                                className="h-8 gap-1.5 rounded-lg bg-sky-600 px-3 text-xs hover:bg-sky-700"
                              >
                                {isSavingName ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Check className="h-3.5 w-3.5" />
                                )}
                                Save
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={isSavingName}
                                onClick={cancelNameEdit}
                                className="h-8 rounded-lg px-2 text-xs text-slate-600"
                              >
                                Cancel
                              </Button>
                            </div>
                            <p className="text-xs text-slate-500">
                              Leave blank to let them add their name.
                            </p>
                          </form>
                        ) : (
                          <>
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span
                                className={`truncate text-sm font-semibold ${user.name ? "text-slate-900" : "text-slate-500"}`}
                                title={user.name || undefined}
                              >
                                {user.name || "Name not added"}
                              </span>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 shrink-0 rounded-md text-slate-400 hover:bg-sky-50 hover:text-sky-700"
                                aria-label={`Edit name for ${identity}`}
                                disabled={updateUserName.isPending}
                                onClick={() => {
                                  setNameDrafts({ [user.id]: user.name ?? "" });
                                  setEditingUserId(user.id);
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                            {user.email && (
                              <p
                                className="mt-0.5 truncate text-xs text-slate-500"
                                title={user.email}
                              >
                                {user.email}
                              </p>
                            )}
                            {isCurrentUser && (
                              <span className="mt-1.5 inline-flex rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                                You
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <p className="mb-1.5 text-xs font-medium text-slate-500 lg:hidden">
                        Role
                      </p>
                      <Select
                        value={user.role}
                        disabled={isCurrentUser || updateUserRole.isPending}
                        onValueChange={(value) =>
                          updateUserRole.mutate({
                            userId: user.id,
                            role: value as Role,
                          })
                        }
                      >
                        <SelectTrigger
                          aria-label={`Role for ${identity}`}
                          title={
                            isCurrentUser
                              ? "You cannot change your own admin role."
                              : undefined
                          }
                          className="h-9 w-full rounded-lg border-slate-200 bg-white text-sm shadow-none"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map((role) => (
                            <SelectItem key={role} value={role}>
                              {ROLE_LABELS[role]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="min-w-0">
                      <p className="mb-1.5 text-xs font-medium text-slate-500 lg:hidden">
                        Schedule access
                      </p>
                      {user.role === "admin" || user.role === "team_lead" ? (
                        <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-sky-800">
                          <Shield className="h-3.5 w-3.5 shrink-0" />
                          All teams’ schedules
                        </div>
                      ) : (
                        <p
                          className={`mb-2 text-sm font-medium ${accessNeedsSetup ? "text-amber-800" : "text-slate-700"}`}
                        >
                          {accessNeedsSetup
                            ? "Staff link needed"
                            : "Linked staff profile"}
                        </p>
                      )}
                      {user.role === "admin" ? (
                        <p className="text-xs text-slate-500">
                          Full administrative access
                        </p>
                      ) : (
                        <>
                          <Select
                            value={
                              user.therapistId == null
                                ? "unlinked"
                                : String(user.therapistId)
                            }
                            disabled={linkUserToTherapist.isPending}
                            onValueChange={(value) =>
                              linkUserToTherapist.mutate({
                                userId: user.id,
                                therapistId:
                                  value === "unlinked" ? null : Number(value),
                              })
                            }
                          >
                            <SelectTrigger
                              className={`h-9 w-full rounded-lg text-xs shadow-none ${accessNeedsSetup ? "border-amber-200 bg-amber-50/60 text-amber-900" : "border-slate-200 bg-white text-slate-600"}`}
                              aria-label={`Staff profile for ${identity}`}
                            >
                              <SelectValue placeholder="Choose staff profile" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="unlinked">
                                {user.role === "team_lead"
                                  ? "Staff profile (optional)"
                                  : "Choose staff profile"}
                              </SelectItem>
                              {therapists.map((therapist) => (
                                <SelectItem
                                  key={therapist.id}
                                  value={String(therapist.id)}
                                  disabled={
                                    therapist.userId != null &&
                                    therapist.userId !== user.id
                                  }
                                >
                                  {therapist.name}
                                  {therapist.teamId != null
                                    ? ` · ${teams.find((team) => team.id === therapist.teamId)?.name ?? `Team ${therapist.teamId}`}`
                                    : " · No team"}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {user.teamName && (
                            <p
                              className="mt-1.5 truncate text-xs text-slate-500"
                              title={user.teamName}
                            >
                              {user.teamName}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                    <div className="min-w-0 border-t border-slate-100 pt-3 sm:col-span-2 lg:col-span-1 lg:border-0 lg:pt-0">
                      <Badge
                        variant="secondary"
                        className={`gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${user.deactivatedAt ? "bg-slate-100 text-slate-600 ring-slate-200" : "bg-emerald-50 text-emerald-700 ring-emerald-200/70"}`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${user.deactivatedAt ? "bg-slate-400" : "bg-emerald-500"}`}
                        />
                        {user.deactivatedAt ? "Deactivated" : "Active"}
                      </Badge>
                      <p className="mt-2 text-xs leading-5 text-slate-500">
                        {isOtherAdmin ? (
                          "Sign-in details hidden"
                        ) : user.lastSignedIn ? (
                          <>
                            Last sign-in
                            <br className="hidden lg:block" />{" "}
                            <span className="text-slate-600">
                              {formatDate(user.lastSignedIn)}
                            </span>
                          </>
                        ) : (
                          "Hasn’t signed in yet"
                        )}
                      </p>
                    </div>
                    <div className="absolute right-5 top-5 sm:right-6 lg:static lg:justify-self-end">
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Actions for ${identity} (account ${user.id})`}
                            className="h-9 w-9 rounded-lg text-slate-500 hover:bg-slate-100"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="w-52 rounded-xl p-1.5"
                        >
                          <DropdownMenuLabel className="text-xs text-slate-500">
                            {isCurrentUser ? "Your account" : "Account actions"}
                          </DropdownMenuLabel>
                          {!isOtherAdmin && (
                            <DropdownMenuItem
                              disabled={updateUserName.isPending}
                              onSelect={() => {
                                setNameDrafts({ [user.id]: user.name ?? "" });
                                setEditingUserId(user.id);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                              Edit name
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            disabled={isCurrentUser || setDeactivated.isPending}
                            onSelect={() =>
                              setDeactivated.mutate({
                                userId: user.id,
                                deactivated: !user.deactivatedAt,
                              })
                            }
                          >
                            <UserRound className="h-4 w-4" />
                            {user.deactivatedAt
                              ? "Reactivate account"
                              : "Deactivate account"}
                          </DropdownMenuItem>
                          {!isCurrentUser && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                disabled={deleteUser.isPending}
                                className="text-rose-700 focus:bg-rose-50 focus:text-rose-800"
                                onSelect={() => {
                                  setDeleteConfirmation("");
                                  setAccountToDelete({
                                    id: user.id,
                                    label: `${identity || "Account"} (account ${user.id})`,
                                  });
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                                Delete permanently
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Pending invites"
          description="Invitations waiting for a teammate to join."
          count={pendingInvites.length}
        >
          <Table>
            <TableHeader className="bg-slate-50/80">
              <TableRow className="border-slate-100 hover:bg-transparent">
                <TableHead className="h-11 px-5 text-xs font-bold uppercase tracking-wider text-slate-500">Email</TableHead>
                <TableHead className="h-11 px-4 text-xs font-bold uppercase tracking-wider text-slate-500">Role</TableHead>
                <TableHead className="h-11 px-4 text-xs font-bold uppercase tracking-wider text-slate-500">Status</TableHead>
                <TableHead className="h-11 px-5 text-right"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitesQuery.isError ? <ErrorRow columns={4} message="Pending invites could not be loaded." /> : invitesQuery.isLoading ? <LoadingRows columns={4} /> : pendingInvites.length === 0 ? (
                <EmptyRow columns={4} message="There are no pending invitations." />
              ) : pendingInvites.map((item) => (
                <TableRow key={item.id} className="border-slate-100 hover:bg-sky-50/35">
                  <TableCell className="px-5 py-4 font-medium text-slate-800">{item.email}</TableCell>
                  <TableCell className="px-4 py-3">
                    <Select
                      value={item.role}
                      disabled={updateInviteRole.isPending || revokeInvite.isPending || resendInvite.isPending}
                      onValueChange={(role: Role) => updateInviteRole.mutate({ email: item.email, role })}
                    >
                      <SelectTrigger className="h-9 w-[118px] bg-white" aria-label={`Role for ${item.email}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((role) => <SelectItem key={role} value={role}>{ROLE_LABELS[role]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="px-4 py-4">
                    <Badge variant="secondary" className="rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-200/70">
                      Waiting
                    </Badge>
                  </TableCell>
                  <TableCell className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={revokeInvite.isPending || resendInvite.isPending}
                        className="gap-1.5 text-sky-700 hover:bg-sky-50 hover:text-sky-800"
                        onClick={() => resendInvite.mutate({ email: item.email })}
                      >
                        {resendInvite.isPending && resendInvite.variables?.email === item.email
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <Send className="h-4 w-4" />}
                        Resend
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={revokeInvite.isPending || resendInvite.isPending}
                        className="gap-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-700"
                        onClick={() => setInviteToRevoke({ id: item.id, email: item.email })}
                      >
                        <MailX className="h-4 w-4" />
                        Revoke
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>

        <AccessActivity
          sessions={sessionsQuery}
          audit={auditQuery}
          users={users}
          currentUserId={currentUser?.id}
          onRevoke={(id) => revokeSession.mutateAsync({ sessionId: id })}
          revoking={revokeSession.isPending}
        />
      </div>

      <AlertDialog
        open={accountToDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleteUser.isPending) {
            setAccountToDelete(null);
            setDeleteConfirmation("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete this account?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes {accountToDelete?.label} and signs them out.
              Their invitations and sign-in links will stop working. This cannot be undone;
              returning users will need a new invitation. Their staff profile, schedules,
              message history, and audit records will remain.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label htmlFor="delete-account-confirmation" className="text-sm font-medium">
            Type DELETE to confirm
          </label>
          <Input
            id="delete-account-confirmation"
            value={deleteConfirmation}
            onChange={(event) => setDeleteConfirmation(event.target.value)}
            disabled={deleteUser.isPending}
            autoComplete="off"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteUser.isPending}>Keep account</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-700 text-white hover:bg-rose-800"
              disabled={deleteUser.isPending || deleteConfirmation !== "DELETE" || !accountToDelete}
              onClick={(event) => {
                event.preventDefault();
                if (accountToDelete && deleteConfirmation === "DELETE") {
                  deleteUser.mutate({ userId: accountToDelete.id, confirmation: "DELETE" });
                }
              }}
            >
              {deleteUser.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={inviteToRevoke !== null}
        onOpenChange={(open) => {
          if (!open && !revokeInvite.isPending) setInviteToRevoke(null);
        }}
      >
        <AlertDialogContent className="rounded-2xl border-slate-200 sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-slate-900">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-rose-50 text-rose-700">
                <MailX className="h-4 w-4" />
              </span>
              Revoke pending invite?
            </AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed text-slate-600">
              <strong className="font-semibold text-slate-800">{inviteToRevoke?.email}</strong> will no longer be able to use this invitation or any unused sign-in link. You can send a corrected invite afterward.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revokeInvite.isPending}>Keep invite</AlertDialogCancel>
            <AlertDialogAction
              disabled={revokeInvite.isPending || !inviteToRevoke}
              className="bg-rose-700 text-white hover:bg-rose-800"
              onClick={(event) => {
                event.preventDefault();
                if (inviteToRevoke) revokeInvite.mutate({ id: inviteToRevoke.id });
              }}
            >
              {revokeInvite.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Revoke invite
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
