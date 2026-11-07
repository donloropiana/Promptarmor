/**
 * Database typing for every Supabase client in lib/supabase/*.
 *
 * database.types.ts is generated from supabase/migrations/*.sql in the
 * postgres-meta typegen format. Once the migrations are applied to the
 * project, regenerate it with the Supabase MCP generate_typescript_types tool
 * (or `supabase gen types typescript`) and overwrite the file.
 */
export type { Database, Json, Tables, TablesInsert, TablesUpdate } from "./database.types";

/** Membership role. The only two roles in the product. */
export type ProfileRole = "owner" | "member";

/** Row returned by rpc('peek_invitation', { p_token }). */
export type PeekInvitationRow = {
  profile_name: string;
  role: ProfileRole;
  invited_by_name: string | null;
  masked_email: string;
  status: "pending" | "expired" | "revoked" | "accepted";
  expires_at: string;
  email_matches: boolean;
  email_verified: boolean;
};
