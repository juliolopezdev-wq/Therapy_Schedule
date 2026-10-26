import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ChevronDown, LogOut, Shield } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  team_lead: "Team Lead",
  staff: "Staff",
  viewer: "View only",
};

export default function UserMenu({ inline = false }: { inline?: boolean }) {
  const { user, logout } = useAuth();

  if (!user) return null;

  const initial = (user.name || user.email || "?").charAt(0).toUpperCase();

  return (
    <div className={cn(inline ? "relative shrink-0" : "fixed top-3 right-3 z-50")}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${ROLE_LABEL[user.role] ?? user.role} account menu`}
            className={cn(
              "group flex h-10 items-center gap-2 border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
              inline
                ? "rounded-full border-white/15 bg-white/10 px-3 text-white hover:bg-white/20 data-[state=open]:bg-white/20"
                : "rounded-full bg-background/90 px-2 shadow-sm backdrop-blur hover:bg-accent",
            )}
          >
            {inline && user.role === "admin" ? (
              <Shield className="h-4 w-4 shrink-0 text-blue-100" />
            ) : (
              <Avatar className="h-7 w-7">
                <AvatarFallback className={cn(inline && "bg-white/90 text-slate-700")}>{initial}</AvatarFallback>
              </Avatar>
            )}
            {inline ? (
              <>
                <span className="hidden min-w-0 flex-col text-left leading-tight sm:flex">
                  <span className="max-w-36 truncate text-sm font-semibold tracking-tight">{user.name || user.email || "Account"}</span>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-blue-100">{ROLE_LABEL[user.role] ?? user.role}</span>
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-blue-100 transition-transform duration-200 group-data-[state=open]:rotate-180" />
              </>
            ) : (
              <Badge variant="secondary" className="hidden text-xs sm:inline-flex">
                {ROLE_LABEL[user.role] ?? user.role}
              </Badge>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 rounded-xl border-slate-200/80 p-1.5 shadow-xl shadow-slate-900/10">
          <DropdownMenuLabel className="flex flex-col">
            <span className="font-medium">{user.name || "Signed in"}</span>
            <span className="text-xs text-muted-foreground font-normal">{user.email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {user.role === "admin" && (
            <DropdownMenuItem asChild>
              <Link href="/admin/users" className="flex items-center gap-2 w-full">
                <Shield className="h-4 w-4" /> Manage users
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => logout()} className="flex items-center gap-2">
            <LogOut className="h-4 w-4" /> Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
