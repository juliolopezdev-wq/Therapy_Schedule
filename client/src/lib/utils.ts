import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  team_lead: "Team Lead",
  staff: "Staff",
  viewer: "View only",
};

/** A staff member's display name, never their raw email -- falls back to their role when no
 *  name is on file (e.g. an admin account invited by email that hasn't set a display name). */
export function staffDisplayName(person: {
  name?: string | null;
  role?: string | null;
}) {
  if (person.name) return person.name;
  return (person.role && ROLE_LABEL[person.role]) || "Staff member";
}
