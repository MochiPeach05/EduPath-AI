export type AppRole = "admin" | "student" | "faculty_board" | "department_head" | "lecturer" | "advisor";
/** Every role, in the order lists show them (Quản trị viên first, Sinh viên last). */
export const appRoles: readonly AppRole[] = ["admin", "faculty_board", "department_head", "lecturer", "advisor", "student"];
export const canAccessAdmin = (role: AppRole) => ["admin", "faculty_board", "department_head", "lecturer", "advisor"].includes(role);
/** Cố vấn học tập (advisor, 2026-11-03) only reads the admin portal: the function list leaves every change to Quản trị viên. */
export const canManageAdmin = (role: AppRole) => canAccessAdmin(role) && role !== "advisor";
/** Who manages the advisors and their classes (AD-ADV-01…03): the admins and Ban chủ nhiệm khoa. */
export const canManageAdvisors = (role: AppRole) => role === "admin" || role === "faculty_board";

export interface AuthenticatedUser {
  userId: string;
  identityKey: string;
  tenantId: string;
  objectId: string;
  name: string;
  email: string | null;
  username: string | null;
  role: AppRole;
  signedInAt: string;
}

export type AuthResponse =
  | { authenticated: false }
  // studentPortal is false for staff mailboxes, which belong to the admin portal only.
  | { authenticated: true; user: AuthenticatedUser; studentPortal?: boolean };
