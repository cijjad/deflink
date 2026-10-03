export type OrgRole =
  | "ORG_ADMIN"
  | "PROCUREMENT_OFFICER"
  | "PROCUREMENT_MANAGER"
  | "FINANCE"
  | "COMPLIANCE_OFFICER"
  | "LOGISTICS"
  | "APPROVER"
  | "VIEWER";

export type Permission =
  | "rfq.create"
  | "rfq.view"
  | "quote.shortlist"
  | "message.send"
  | "quote.submit"
  | "org.manage"
  | "compliance.review";

const MATRIX: Record<Permission, OrgRole[]> = {
  "rfq.create": ["ORG_ADMIN", "PROCUREMENT_OFFICER", "PROCUREMENT_MANAGER"],
  "rfq.view": ["ORG_ADMIN", "PROCUREMENT_OFFICER", "PROCUREMENT_MANAGER", "FINANCE", "COMPLIANCE_OFFICER", "LOGISTICS", "APPROVER", "VIEWER"],
  "quote.shortlist": ["ORG_ADMIN", "PROCUREMENT_OFFICER", "PROCUREMENT_MANAGER", "APPROVER"],
  "message.send": ["ORG_ADMIN", "PROCUREMENT_OFFICER", "PROCUREMENT_MANAGER", "LOGISTICS"],
  "quote.submit": ["ORG_ADMIN", "PROCUREMENT_OFFICER", "PROCUREMENT_MANAGER"],
  "org.manage": ["ORG_ADMIN"],
  "compliance.review": ["COMPLIANCE_OFFICER"],
};

export function can(role: OrgRole, permission: Permission): boolean {
  return MATRIX[permission].includes(role);
}

export const ROLE_LABEL: Record<OrgRole, string> = {
  ORG_ADMIN: "Organization Admin",
  PROCUREMENT_OFFICER: "Procurement Officer",
  PROCUREMENT_MANAGER: "Procurement Manager",
  FINANCE: "Finance",
  COMPLIANCE_OFFICER: "Compliance Officer",
  LOGISTICS: "Logistics",
  APPROVER: "Approver",
  VIEWER: "Viewer",
};
