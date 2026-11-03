export type AppRole = "admin" | "student" | "faculty_board" | "department_head" | "lecturer" | "advisor";
/** Every role, in the order lists show them (Quản trị viên first, Sinh viên last). */
export const appRoles = ["admin", "faculty_board", "department_head", "lecturer", "advisor", "student"] as const satisfies readonly AppRole[];
export const adminRoles: readonly AppRole[] = ["admin", "faculty_board", "department_head", "lecturer", "advisor"];
export const canAccessAdmin = (role: AppRole) => adminRoles.includes(role);
/**
 * Roles that may change data in the admin portal. Cố vấn học tập (advisor, migration 058) only reads it: the function list
 * gives the CVHT the "QTV & CVHT" rows (views) and leaves every change to the Quản trị viên rows.
 */
export const canManageAdmin = (role: AppRole) => canAccessAdmin(role) && role !== "advisor";
/** Who manages the advisors and their classes (AD-ADV-01…03): the admins and Ban chủ nhiệm khoa. */
export const canManageAdvisors = (role: AppRole) => role === "admin" || role === "faculty_board";

export interface AuthTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
  codeChallenge: string;
  returnTo: string;
  createdAt: number;
}

export interface MicrosoftIdentity {
  tenantId: string;
  objectId: string;
  subject: string;
  name: string;
  email: string | null;
  username: string | null;
  // The login_hint optional claim, replayed as logout_hint so Microsoft can end
  // the right session without showing its account picker.
  loginHint: string | null;
  roles: string[];
  nonce: string;
  audience: string;
  issuer: string;
  expiresAt: number;
}

export interface AuthenticatedUser {
  authVersion?: number;
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

export interface MicrosoftAuthClient {
  getAuthorizationUrl(transaction: AuthTransaction): Promise<string>;
  exchangeAuthorizationCode(
    code: string,
    codeVerifier: string,
    nonce: string
  ): Promise<MicrosoftIdentity>;
  getLogoutUrl(
    tenantId?: string,
    returnPath?: "/" | "/quantri",
    logoutHint?: string
  ): string;
}
