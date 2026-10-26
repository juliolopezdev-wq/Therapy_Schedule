import { useAuth } from "@/_core/hooks/useAuth";
import type { User } from "../../../drizzle/schema";
import { Link, Redirect } from "wouter";

type ProtectedRouteProps = {
  children: React.ReactNode;
  /** Roles allowed to view this route. Omit to allow any authenticated role. */
  roles?: Array<User["role"]>;
};

export default function ProtectedRoute({ children, roles }: ProtectedRouteProps) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen text-muted-foreground">Loading...</div>;
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  if (roles && !roles.includes(user.role)) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <h1 className="text-xl font-bold text-slate-900">Admin access required</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Your account does not have permission to manage users.
          </p>
          <Link
            href="/board"
            className="mt-5 inline-flex h-10 items-center justify-center rounded-lg bg-sky-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-sky-500"
          >
            Return to board
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
