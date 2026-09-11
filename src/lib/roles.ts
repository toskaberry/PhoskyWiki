import type { UserRole } from "@/db/schema";

export const administratorRoles = ["admin", "superadmin"] as const;
export const assignableRoles = ["editor", "admin", "superadmin"] as const;
export type AssignableRole = (typeof assignableRoles)[number];
export function hasAdminRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "superadmin";
}
export const roleLabels: Record<UserRole, string> = {
  editor: "编者", admin: "管理员", superadmin: "超级管理员", trusted: "编者",
};
