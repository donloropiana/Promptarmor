// Generated from supabase/migrations/*.sql (applied to PGlite and introspected)
// in the postgres-meta typegen format. Regenerate with
// mcp__supabase-promptarmor__generate_typescript_types once the migrations are
// applied to project dquwmmysasjvvgxnbhdl; the shapes must match.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      ai_usage: {
        Row: {
          analysis_run_id: string | null
          budget_day: string
          cost_usd: number
          created_at: string
          id: string
          input_tokens: number
          model: string | null
          output_tokens: number
          profile_id: string
          purpose: string
          request_id: string
          requested_by: string | null
          reserved_usd: number
          settled_at: string | null
          source_item_id: string | null
          status: string
        }
        Insert: {
          analysis_run_id?: string | null
          budget_day?: string
          cost_usd?: number
          created_at?: string
          id?: string
          input_tokens?: number
          model?: string | null
          output_tokens?: number
          profile_id: string
          purpose?: string
          request_id: string
          requested_by?: string | null
          reserved_usd: number
          settled_at?: string | null
          source_item_id?: string | null
          status?: string
        }
        Update: {
          analysis_run_id?: string | null
          budget_day?: string
          cost_usd?: number
          created_at?: string
          id?: string
          input_tokens?: number
          model?: string | null
          output_tokens?: number
          profile_id?: string
          purpose?: string
          request_id?: string
          requested_by?: string | null
          reserved_usd?: number
          settled_at?: string | null
          source_item_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_run_fk"
            columns: ["analysis_run_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "ai_usage_source_item_fk"
            columns: ["source_item_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "source_items"
            referencedColumns: ["id", "profile_id"]
          },
        ]
      }
      analysis_runs: {
        Row: {
          asset_version_id: string
          completed_at: string | null
          cost_usd: number
          coverage: Json
          created_at: string
          error: string | null
          id: string
          input_metadata: Json
          input_tokens: number
          model: string | null
          offer_version_ids: string[]
          output_tokens: number
          profile_id: string
          prompt_hash: string | null
          reuse_key: string | null
          reused_from_run_id: string | null
          rule_results: Json
          rule_version_ids: string[]
          stage: string | null
          status: string
        }
        Insert: {
          asset_version_id: string
          completed_at?: string | null
          cost_usd?: number
          coverage?: Json
          created_at?: string
          error?: string | null
          id?: string
          input_metadata?: Json
          input_tokens?: number
          model?: string | null
          offer_version_ids?: string[]
          output_tokens?: number
          profile_id: string
          prompt_hash?: string | null
          reuse_key?: string | null
          reused_from_run_id?: string | null
          rule_results?: Json
          rule_version_ids?: string[]
          stage?: string | null
          status?: string
        }
        Update: {
          asset_version_id?: string
          completed_at?: string | null
          cost_usd?: number
          coverage?: Json
          created_at?: string
          error?: string | null
          id?: string
          input_metadata?: Json
          input_tokens?: number
          model?: string | null
          offer_version_ids?: string[]
          output_tokens?: number
          profile_id?: string
          prompt_hash?: string | null
          reuse_key?: string | null
          reused_from_run_id?: string | null
          rule_results?: Json
          rule_version_ids?: string[]
          stage?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_runs_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analysis_runs_reused_from_fk"
            columns: ["reused_from_run_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "analysis_runs_version_fk"
            columns: ["asset_version_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "asset_versions"
            referencedColumns: ["id", "profile_id"]
          },
        ]
      }
      asset_sources: {
        Row: {
          asset_id: string
          created_at: string
          profile_id: string
          source_item_id: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          profile_id: string
          source_item_id: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          profile_id?: string
          source_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_sources_asset_fk"
            columns: ["asset_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "asset_sources_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_sources_source_item_fk"
            columns: ["source_item_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "source_items"
            referencedColumns: ["id", "profile_id"]
          },
        ]
      }
      asset_versions: {
        Row: {
          asset_id: string
          author_id: string | null
          content: Json
          content_sha256: string
          created_at: string
          extracted_text: string | null
          id: string
          normalized_text_hash: string | null
          origin: string
          profile_id: string
          source_item_id: string | null
          storage_path: string | null
          version_no: number
        }
        Insert: {
          asset_id: string
          author_id?: string | null
          content?: Json
          content_sha256: string
          created_at?: string
          extracted_text?: string | null
          id?: string
          normalized_text_hash?: string | null
          origin: string
          profile_id: string
          source_item_id?: string | null
          storage_path?: string | null
          version_no: number
        }
        Update: {
          asset_id?: string
          author_id?: string | null
          content?: Json
          content_sha256?: string
          created_at?: string
          extracted_text?: string | null
          id?: string
          normalized_text_hash?: string | null
          origin?: string
          profile_id?: string
          source_item_id?: string | null
          storage_path?: string | null
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "asset_versions_asset_fk"
            columns: ["asset_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "asset_versions_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_versions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_versions_source_item_fk"
            columns: ["source_item_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "source_items"
            referencedColumns: ["id", "profile_id"]
          },
        ]
      }
      assets: {
        Row: {
          approval_expires_at: string | null
          archive_reason: string | null
          archived_at: string | null
          approved_decision_id: string | null
          approved_version_id: string | null
          assignee_id: string | null
          audience: string | null
          campaign_id: string | null
          changed_after_approval: boolean | null
          channel: string | null
          created_at: string
          created_by: string | null
          due_date: string | null
          expires_at: string | null
          id: string
          in_market_from: string | null
          live_at: string | null
          live_channel: string | null
          live_url: string | null
          in_market_to: string | null
          is_draft: boolean | null
          latest_version_id: string | null
          product: string
          profile_id: string
          re_review_reason: Json | null
          retain_until: string | null
          states: string[]
          status: string
          submitted_at: string | null
          submitter_email: string | null
          submitter_name: string | null
          submitter_org: string | null
          title: string
          updated_at: string
        }
        Insert: {
          approval_expires_at?: string | null
          archive_reason?: string | null
          archived_at?: string | null
          approved_decision_id?: string | null
          approved_version_id?: string | null
          assignee_id?: string | null
          audience?: string | null
          campaign_id?: string | null
          changed_after_approval?: never
          channel?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          expires_at?: string | null
          id?: string
          in_market_from?: string | null
          live_at?: string | null
          live_channel?: string | null
          live_url?: string | null
          in_market_to?: string | null
          is_draft?: never
          latest_version_id?: string | null
          product?: string
          profile_id: string
          re_review_reason?: Json | null
          retain_until?: string | null
          states?: string[]
          status?: string
          submitted_at?: string | null
          submitter_email?: string | null
          submitter_name?: string | null
          submitter_org?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          approval_expires_at?: string | null
          archive_reason?: string | null
          archived_at?: string | null
          approved_decision_id?: string | null
          approved_version_id?: string | null
          assignee_id?: string | null
          audience?: string | null
          campaign_id?: string | null
          changed_after_approval?: never
          channel?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          expires_at?: string | null
          id?: string
          in_market_from?: string | null
          live_at?: string | null
          live_channel?: string | null
          live_url?: string | null
          in_market_to?: string | null
          is_draft?: never
          latest_version_id?: string | null
          product?: string
          profile_id?: string
          re_review_reason?: Json | null
          retain_until?: string | null
          states?: string[]
          status?: string
          submitted_at?: string | null
          submitter_email?: string | null
          submitter_name?: string | null
          submitter_org?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assets_approved_decision_fk"
            columns: ["approved_decision_id", "id"]
            isOneToOne: false
            referencedRelation: "decisions"
            referencedColumns: ["id", "asset_id"]
          },
          {
            foreignKeyName: "assets_approved_version_fk"
            columns: ["approved_version_id", "id"]
            isOneToOne: false
            referencedRelation: "asset_versions"
            referencedColumns: ["id", "asset_id"]
          },
          {
            foreignKeyName: "assets_assignee_fk"
            columns: ["profile_id", "assignee_id"]
            isOneToOne: false
            referencedRelation: "profile_members"
            referencedColumns: ["profile_id", "user_id"]
          },
          {
            foreignKeyName: "assets_campaign_fk"
            columns: ["campaign_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "assets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_latest_version_fk"
            columns: ["latest_version_id", "id"]
            isOneToOne: false
            referencedRelation: "asset_versions"
            referencedColumns: ["id", "asset_id"]
          },
          {
            foreignKeyName: "assets_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          created_at: string
          created_by: string | null
          defaults: Json
          id: string
          name: string
          profile_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          defaults?: Json
          id?: string
          name: string
          profile_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          defaults?: Json
          id?: string
          name?: string
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      change_requests: {
        Row: {
          asset_id: string
          asset_version_id: string
          author_id: string | null
          created_at: string
          decision_id: string | null
          due_date: string | null
          id: string
          items: Json
          message_text: string | null
          note: string | null
          profile_id: string
          resolved_at: string | null
          status: string
        }
        Insert: {
          asset_id: string
          asset_version_id: string
          author_id?: string | null
          created_at?: string
          decision_id?: string | null
          due_date?: string | null
          id?: string
          items?: Json
          message_text?: string | null
          note?: string | null
          profile_id: string
          resolved_at?: string | null
          status?: string
        }
        Update: {
          asset_id?: string
          asset_version_id?: string
          author_id?: string | null
          created_at?: string
          decision_id?: string | null
          due_date?: string | null
          id?: string
          items?: Json
          message_text?: string | null
          note?: string | null
          profile_id?: string
          resolved_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "change_requests_asset_fk"
            columns: ["asset_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "change_requests_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_requests_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_requests_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_requests_version_fk"
            columns: ["asset_version_id", "asset_id"]
            isOneToOne: false
            referencedRelation: "asset_versions"
            referencedColumns: ["id", "asset_id"]
          },
        ]
      }
      connections: {
        Row: {
          account_email: string | null
          connected_by: string | null
          created_at: string
          cursor: Json
          id: string
          last_error: string | null
          last_synced_at: string | null
          nango_connection_id: string
          nango_revoked_at: string | null
          profile_id: string
          provider: string
          provider_config_key: string
          provider_group: string | null
          status: string
          updated_at: string
          watch: Json
        }
        Insert: {
          account_email?: string | null
          connected_by?: string | null
          created_at?: string
          cursor?: Json
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          nango_connection_id: string
          nango_revoked_at?: string | null
          profile_id: string
          provider: string
          provider_config_key: string
          provider_group?: never
          status?: string
          updated_at?: string
          watch?: Json
        }
        Update: {
          account_email?: string | null
          connected_by?: string | null
          created_at?: string
          cursor?: Json
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          nango_connection_id?: string
          nango_revoked_at?: string | null
          profile_id?: string
          provider?: string
          provider_config_key?: string
          provider_group?: never
          status?: string
          updated_at?: string
          watch?: Json
        }
        Relationships: [
          {
            foreignKeyName: "connections_connected_by_fkey"
            columns: ["connected_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connections_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      decisions: {
        Row: {
          analysis_run_id: string | null
          approver_email: string | null
          approver_id: string
          asset_id: string
          asset_snapshot: Json
          asset_version_id: string
          attested: boolean
          auth_method: string | null
          content_sha256: string
          created_at: string
          decision: string
          dismissed: Json
          exceptions: Json
          id: string
          manual_only: boolean
          profile_id: string
          rationale: string | null
          self_approved: boolean
        }
        Insert: {
          analysis_run_id?: string | null
          approver_email?: string | null
          approver_id: string
          asset_id: string
          asset_snapshot?: Json
          asset_version_id: string
          attested?: boolean
          auth_method?: string | null
          content_sha256: string
          created_at?: string
          decision: string
          dismissed?: Json
          exceptions?: Json
          id?: string
          manual_only?: boolean
          profile_id: string
          rationale?: string | null
          self_approved?: boolean
        }
        Update: {
          analysis_run_id?: string | null
          approver_email?: string | null
          approver_id?: string
          asset_id?: string
          asset_snapshot?: Json
          asset_version_id?: string
          attested?: boolean
          auth_method?: string | null
          content_sha256?: string
          created_at?: string
          decision?: string
          dismissed?: Json
          exceptions?: Json
          id?: string
          manual_only?: boolean
          profile_id?: string
          rationale?: string | null
          self_approved?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "decisions_approver_id_fkey"
            columns: ["approver_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decisions_asset_fk"
            columns: ["asset_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "decisions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decisions_run_fk"
            columns: ["analysis_run_id", "asset_version_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs"
            referencedColumns: ["id", "asset_version_id"]
          },
          {
            foreignKeyName: "decisions_version_fk"
            columns: ["asset_version_id", "asset_id"]
            isOneToOne: false
            referencedRelation: "asset_versions"
            referencedColumns: ["id", "asset_id"]
          },
        ]
      }
      events: {
        Row: {
          actor_id: string | null
          asset_id: string | null
          created_at: string
          data: Json
          id: number
          kind: string
          profile_id: string
        }
        Insert: {
          actor_id?: string | null
          asset_id?: string | null
          created_at?: string
          data?: Json
          id?: never
          kind: string
          profile_id: string
        }
        Update: {
          actor_id?: string | null
          asset_id?: string | null
          created_at?: string
          data?: Json
          id?: never
          kind?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_asset_fk"
            columns: ["asset_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "events_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      finding_dispositions: {
        Row: {
          actor_id: string | null
          carried_from_disposition_id: string | null
          created_at: string
          disposition: string
          finding_id: string
          id: string
          note: string | null
          profile_id: string
          reason: string | null
          severity_override: string | null
        }
        Insert: {
          actor_id?: string | null
          carried_from_disposition_id?: string | null
          created_at?: string
          disposition: string
          finding_id: string
          id?: string
          note?: string | null
          profile_id: string
          reason?: string | null
          severity_override?: string | null
        }
        Update: {
          actor_id?: string | null
          carried_from_disposition_id?: string | null
          created_at?: string
          disposition?: string
          finding_id?: string
          id?: string
          note?: string | null
          profile_id?: string
          reason?: string | null
          severity_override?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finding_dispositions_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finding_dispositions_carried_from_fk"
            columns: ["carried_from_disposition_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "finding_dispositions"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "finding_dispositions_finding_fk"
            columns: ["finding_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "findings"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "finding_dispositions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      findings: {
        Row: {
          analysis_run_id: string | null
          anchor: Json
          asset_version_id: string
          author_id: string | null
          created_at: string
          evidence_type: string
          explanation: string | null
          id: string
          origin: string
          prior_finding_id: string | null
          profile_id: string
          quote: string | null
          recheck_status: string | null
          reused_from_finding_id: string | null
          rule_version_id: string | null
          section_id: string | null
          severity: string
          span_hash: string | null
          suggested_copy: string | null
          suggested_fix: string | null
          verified_span: boolean
        }
        Insert: {
          analysis_run_id?: string | null
          anchor?: Json
          asset_version_id: string
          author_id?: string | null
          created_at?: string
          evidence_type: string
          explanation?: string | null
          id?: string
          origin?: string
          prior_finding_id?: string | null
          profile_id: string
          quote?: string | null
          recheck_status?: string | null
          reused_from_finding_id?: string | null
          rule_version_id?: string | null
          section_id?: string | null
          severity: string
          span_hash?: string | null
          suggested_copy?: string | null
          suggested_fix?: string | null
          verified_span?: boolean
        }
        Update: {
          analysis_run_id?: string | null
          anchor?: Json
          asset_version_id?: string
          author_id?: string | null
          created_at?: string
          evidence_type?: string
          explanation?: string | null
          id?: string
          origin?: string
          prior_finding_id?: string | null
          profile_id?: string
          quote?: string | null
          recheck_status?: string | null
          reused_from_finding_id?: string | null
          rule_version_id?: string | null
          section_id?: string | null
          severity?: string
          span_hash?: string | null
          suggested_copy?: string | null
          suggested_fix?: string | null
          verified_span?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "findings_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "findings_prior_fk"
            columns: ["prior_finding_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "findings"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "findings_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "findings_reused_from_fk"
            columns: ["reused_from_finding_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "findings"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "findings_rule_version_id_fkey"
            columns: ["rule_version_id"]
            isOneToOne: false
            referencedRelation: "rule_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "findings_run_fk"
            columns: ["analysis_run_id", "asset_version_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs"
            referencedColumns: ["id", "asset_version_id"]
          },
          {
            foreignKeyName: "findings_version_fk"
            columns: ["asset_version_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "asset_versions"
            referencedColumns: ["id", "profile_id"]
          },
        ]
      }
      offer_versions: {
        Row: {
          author_id: string | null
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          offer_id: string
          profile_id: string
          reason: string
          terms: Json
          version_no: number
        }
        Insert: {
          author_id?: string | null
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          offer_id: string
          profile_id: string
          reason: string
          terms?: Json
          version_no: number
        }
        Update: {
          author_id?: string | null
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          offer_id?: string
          profile_id?: string
          reason?: string
          terms?: Json
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "offer_versions_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_versions_offer_fk"
            columns: ["offer_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "offer_versions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      offers: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          name: string
          product: string
          profile_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          name: string
          product: string
          profile_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          name?: string
          product?: string
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "offers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          profile_id: string
          revoked_at: string | null
          role: string
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          profile_id: string
          revoked_at?: string | null
          role?: string
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          profile_id?: string
          revoked_at?: string | null
          role?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_invitations_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_invitations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_members: {
        Row: {
          created_at: string
          invited_by: string | null
          profile_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          invited_by?: string | null
          profile_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          invited_by?: string | null
          profile_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_members_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          settings: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          settings?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          settings?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      recheck_verifications: {
        Row: {
          asset_version_id: string
          change_request_id: string
          created_at: string
          finding_id: string | null
          id: string
          item_index: number | null
          note: string | null
          profile_id: string
          status: string
          verified_by: string
        }
        Insert: {
          asset_version_id: string
          change_request_id: string
          created_at?: string
          finding_id?: string | null
          id?: string
          item_index?: number | null
          note?: string | null
          profile_id: string
          status: string
          verified_by?: string
        }
        Update: {
          asset_version_id?: string
          change_request_id?: string
          created_at?: string
          finding_id?: string | null
          id?: string
          item_index?: number | null
          note?: string | null
          profile_id?: string
          status?: string
          verified_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "recheck_verifications_cr_fk"
            columns: ["change_request_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "change_requests"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "recheck_verifications_finding_fk"
            columns: ["finding_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "findings"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "recheck_verifications_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recheck_verifications_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recheck_verifications_version_fk"
            columns: ["asset_version_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "asset_versions"
            referencedColumns: ["id", "profile_id"]
          },
        ]
      }
      reference_library: {
        Row: {
          citation: string
          created_at: string
          id: string
          label: string
          summary: string | null
          url: string | null
          verified_as_of: string | null
        }
        Insert: {
          citation: string
          created_at?: string
          id: string
          label: string
          summary?: string | null
          url?: string | null
          verified_as_of?: string | null
        }
        Update: {
          citation?: string
          created_at?: string
          id?: string
          label?: string
          summary?: string | null
          url?: string | null
          verified_as_of?: string | null
        }
        Relationships: []
      }
      review_sessions: {
        Row: {
          active_seconds: number
          asset_version_id: string | null
          id: string
          last_heartbeat_at: string
          profile_id: string
          source_item_id: string | null
          started_at: string
          surface: string
          user_id: string
        }
        Insert: {
          active_seconds?: number
          asset_version_id?: string | null
          id?: string
          last_heartbeat_at?: string
          profile_id: string
          source_item_id?: string | null
          started_at?: string
          surface?: string
          user_id?: string
        }
        Update: {
          active_seconds?: number
          asset_version_id?: string | null
          id?: string
          last_heartbeat_at?: string
          profile_id?: string
          source_item_id?: string | null
          started_at?: string
          surface?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_sessions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_sessions_source_item_fk"
            columns: ["source_item_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "source_items"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "review_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_sessions_version_fk"
            columns: ["asset_version_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "asset_versions"
            referencedColumns: ["id", "profile_id"]
          },
        ]
      }
      rule_versions: {
        Row: {
          applies_to: string[]
          author_id: string | null
          body: string
          created_at: string
          default_severity: string
          id: string
          metadata: Json
          profile_id: string | null
          reason: string
          reference_ids: string[]
          rule_id: string
          title: string
          version_no: number
        }
        Insert: {
          applies_to?: string[]
          author_id?: string | null
          body: string
          created_at?: string
          default_severity: string
          id?: string
          metadata?: Json
          profile_id?: string | null
          reason: string
          reference_ids?: string[]
          rule_id: string
          title: string
          version_no: number
        }
        Update: {
          applies_to?: string[]
          author_id?: string | null
          body?: string
          created_at?: string
          default_severity?: string
          id?: string
          metadata?: Json
          profile_id?: string | null
          reason?: string
          reference_ids?: string[]
          rule_id?: string
          title?: string
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "rule_versions_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rule_versions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rule_versions_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "rules"
            referencedColumns: ["id"]
          },
        ]
      }
      rules: {
        Row: {
          active: boolean
          cloned_from: string | null
          code: string
          created_at: string
          current_version_id: string | null
          id: string
          kind: string
          profile_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          cloned_from?: string | null
          code: string
          created_at?: string
          current_version_id?: string | null
          id?: string
          kind: string
          profile_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          cloned_from?: string | null
          code?: string
          created_at?: string
          current_version_id?: string | null
          id?: string
          kind?: string
          profile_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rules_cloned_from_fkey"
            columns: ["cloned_from"]
            isOneToOne: false
            referencedRelation: "rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rules_current_version_fk"
            columns: ["current_version_id", "id"]
            isOneToOne: false
            referencedRelation: "rule_versions"
            referencedColumns: ["id", "rule_id"]
          },
          {
            foreignKeyName: "rules_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      security_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          asset_version_id: string | null
          created_at: string
          excerpt: string | null
          id: string
          kind: string
          location: Json
          profile_id: string
          source_item_id: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          asset_version_id?: string | null
          created_at?: string
          excerpt?: string | null
          id?: string
          kind: string
          location?: Json
          profile_id: string
          source_item_id?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          asset_version_id?: string | null
          created_at?: string
          excerpt?: string | null
          id?: string
          kind?: string
          location?: Json
          profile_id?: string
          source_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "security_alerts_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "security_alerts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "security_alerts_source_item_fk"
            columns: ["source_item_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "source_items"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "security_alerts_version_fk"
            columns: ["asset_version_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "asset_versions"
            referencedColumns: ["id", "profile_id"]
          },
        ]
      }
      source_items: {
        Row: {
          asset_id: string | null
          candidate_asset_id: string | null
          classification: string
          classification_reason: string | null
          connection_id: string | null
          content_sha256: string | null
          created_at: string
          duplicate_of: string | null
          external_id: string | null
          extracted_text: string | null
          id: string
          inferred: Json
          kind: string
          match_reason: string | null
          match_score: number | null
          metadata: Json
          mime_type: string | null
          normalized_text_hash: string | null
          occurred_at: string | null
          parent_external_id: string | null
          parent_source_item_id: string | null
          profile_id: string
          provider: string
          sender: string | null
          sender_email: string | null
          size_bytes: number | null
          snoozed_until: string | null
          source_key: string
          source_revision: string | null
          source_url: string | null
          storage_path: string | null
          title: string | null
          triage_reason: string | null
          triage_status: string
          triaged_at: string | null
          triaged_by: string | null
          updated_at: string
          visibility: string | null
        }
        Insert: {
          asset_id?: string | null
          candidate_asset_id?: string | null
          classification?: string
          classification_reason?: string | null
          connection_id?: string | null
          content_sha256?: string | null
          created_at?: string
          duplicate_of?: string | null
          external_id?: string | null
          extracted_text?: string | null
          id?: string
          inferred?: Json
          kind: string
          match_reason?: string | null
          match_score?: number | null
          metadata?: Json
          mime_type?: string | null
          normalized_text_hash?: string | null
          occurred_at?: string | null
          parent_external_id?: string | null
          parent_source_item_id?: string | null
          profile_id: string
          provider: string
          sender?: string | null
          sender_email?: string | null
          size_bytes?: number | null
          snoozed_until?: string | null
          source_key: string
          source_revision?: string | null
          source_url?: string | null
          storage_path?: string | null
          title?: string | null
          triage_reason?: string | null
          triage_status?: string
          triaged_at?: string | null
          triaged_by?: string | null
          updated_at?: string
          visibility?: never
        }
        Update: {
          asset_id?: string | null
          candidate_asset_id?: string | null
          classification?: string
          classification_reason?: string | null
          connection_id?: string | null
          content_sha256?: string | null
          created_at?: string
          duplicate_of?: string | null
          external_id?: string | null
          extracted_text?: string | null
          id?: string
          inferred?: Json
          kind?: string
          match_reason?: string | null
          match_score?: number | null
          metadata?: Json
          mime_type?: string | null
          normalized_text_hash?: string | null
          occurred_at?: string | null
          parent_external_id?: string | null
          parent_source_item_id?: string | null
          profile_id?: string
          provider?: string
          sender?: string | null
          sender_email?: string | null
          size_bytes?: number | null
          snoozed_until?: string | null
          source_key?: string
          source_revision?: string | null
          source_url?: string | null
          storage_path?: string | null
          title?: string | null
          triage_reason?: string | null
          triage_status?: string
          triaged_at?: string | null
          triaged_by?: string | null
          updated_at?: string
          visibility?: never
        }
        Relationships: [
          {
            foreignKeyName: "source_items_asset_fk"
            columns: ["asset_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "source_items_candidate_asset_fk"
            columns: ["candidate_asset_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "source_items_connection_fk"
            columns: ["connection_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "connections"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "source_items_duplicate_of_fk"
            columns: ["duplicate_of", "profile_id"]
            isOneToOne: false
            referencedRelation: "source_items"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "source_items_parent_fk"
            columns: ["parent_source_item_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "source_items"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "source_items_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_items_triaged_by_fkey"
            columns: ["triaged_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_runs: {
        Row: {
          connection_id: string
          error: string | null
          finished_at: string | null
          id: string
          kind: string
          profile_id: string
          started_at: string
          stats: Json
        }
        Insert: {
          connection_id: string
          error?: string | null
          finished_at?: string | null
          id?: string
          kind: string
          profile_id: string
          started_at?: string
          stats?: Json
        }
        Update: {
          connection_id?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          kind?: string
          profile_id?: string
          started_at?: string
          stats?: Json
        }
        Relationships: [
          {
            foreignKeyName: "sync_runs_connection_fk"
            columns: ["connection_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "connections"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "sync_runs_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      webhook_receipts: {
        Row: {
          body_sha256: string
          received_at: string
          source: string
        }
        Insert: {
          body_sha256: string
          received_at?: string
          source?: string
        }
        Update: {
          body_sha256?: string
          received_at?: string
          source?: string
        }
        Relationships: []
      }
    }
    Views: {
      asset_queue: {
        Row: {
          analysis_stage: string | null
          analysis_status: string | null
          approved_decision_id: string | null
          approved_version_id: string | null
          approved_version_no: number | null
          asset_id: string | null
          assignee_id: string | null
          campaign_id: string | null
          changed_after_approval: boolean | null
          channel: string | null
          created_at: string | null
          due_date: string | null
          is_draft: boolean | null
          latest_version_id: string | null
          latest_version_no: number | null
          open_alert_count: number | null
          open_change_request_created_at: string | null
          open_critical: number | null
          open_major: number | null
          open_minor: number | null
          product: string | null
          profile_id: string | null
          re_review_reason: Json | null
          status: string | null
          submitted_at: string | null
          submitter_name: string | null
          submitter_org: string | null
          title: string | null
          top_issue: string | null
          updated_at: string | null
        }
        Relationships: []
      }
      finding_latest_dispositions: {
        Row: {
          actor_id: string | null
          carried_from_disposition_id: string | null
          created_at: string | null
          disposition: string | null
          disposition_id: string | null
          finding_id: string | null
          note: string | null
          profile_id: string | null
          reason: string | null
          severity_override: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_invitation:
        { Args: {
            p_token: string
          }; Returns: string }
      accept_invitation_by_id:
        { Args: {
            p_invitation_id: string
          }; Returns: string }
      acknowledge_security_alert:
        { Args: {
            p_alert_id: string
          }; Returns: undefined }
      ai_budget_status:
        { Args: {
            p_profile_id: string
          }; Returns: {
            budget_day: string
            global_cap_usd: number
            global_used_usd: number
            profile_cap_usd: number
            profile_used_usd: number
            trusted: boolean
            remaining_usd: number
          }[] }
      clone_starter_rules:
        { Args: {
            p_profile_id: string
            p_rule_ids?: string[]
          }; Returns: number }
      create_profile:
        { Args: {
            p_name: string
          }; Returns: string }
      find_unconfirmed_password_user:
        { Args: {
            p_email: string
          }; Returns: string }
      invite_member:
        { Args: {
            p_profile_id: string
            p_email: string
            p_role?: string
          }; Returns: string }
      leave_profile:
        { Args: {
            p_profile_id: string
          }; Returns: undefined }
      my_pending_invitations:
        { Args: never; Returns: {
            invitation_id: string
            profile_id: string
            profile_name: string
            role: string
            invited_by_name: string
            invited_by_email: string
            created_at: string
            expires_at: string
          }[] }
      peek_invitation:
        { Args: {
            p_token: string
          }; Returns: {
            profile_name: string
            role: string
            invited_by_name: string
            masked_email: string
            status: string
            expires_at: string
            email_matches: boolean
            email_verified: boolean
          }[] }
      record_decision:
        { Args: {
            p_asset_version_id: string
            p_decision: string
            p_exceptions?: Json
            p_rationale?: string
            p_attested?: boolean
            p_change_request?: Json
          }; Returns: string }
      recover_stale_syncs:
        { Args: {
            p_stale_after?: string
          }; Returns: number }
      reissue_invitation:
        { Args: {
            p_invitation_id: string
          }; Returns: string }
      release_ai_budget:
        { Args: {
            p_request_id: string
          }; Returns: undefined }
      remove_member:
        { Args: {
            p_profile_id: string
            p_user_id: string
          }; Returns: undefined }
      reserve_ai_budget:
        { Args: {
            p_profile_id: string
            p_est_usd: number
            p_request_id: string
            p_user_id?: string
            p_purpose?: string
            p_source_item_id?: string
            p_analysis_run_id?: string
          }; Returns: boolean }
      revoke_invitation:
        { Args: {
            p_invitation_id: string
          }; Returns: undefined }
      set_member_role:
        { Args: {
            p_profile_id: string
            p_user_id: string
            p_role: string
          }; Returns: undefined }
      settle_ai_budget:
        { Args: {
            p_request_id: string
            p_actual_cost: number
            p_input_tokens?: number
            p_output_tokens?: number
            p_model?: string
            p_analysis_run_id?: string
          }; Returns: undefined }
      submit_for_review:
        { Args: {
            p_asset_id: string
          }; Returns: string }
      update_asset:
        { Args: {
            p_asset_id: string
            p_patch: Json
          }; Returns: undefined }
      update_profile_settings:
        { Args: {
            p_profile_id: string
            p_patch: Json
          }; Returns: Json }
      withdraw_approval:
        { Args: {
            p_asset_id: string
            p_rationale: string
          }; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
