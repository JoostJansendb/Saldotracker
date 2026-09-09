export const userRoles = ["user", "dev", "admin"] as const;
export type UserRole = (typeof userRoles)[number];

// Alleen deze gebruiker mag van rol wisselen: zo kan hij de app als gebruiker, dev of admin bekijken
// en daarna weer terug. De check gaat op naam, niet op rol, anders zou hij na een wissel vastzitten.
export const roleSwitcherName = "Joost Jansen";

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (userRoles as readonly string[]).includes(value);
}
