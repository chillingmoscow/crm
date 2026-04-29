export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

// Custom types for working_hours JSONB column
export interface WorkingHoursDay {
  open?: string
  close?: string
  closed: boolean
}

export interface WorkingHours {
  mon?: WorkingHoursDay
  tue?: WorkingHoursDay
  wed?: WorkingHoursDay
  thu?: WorkingHoursDay
  fri?: WorkingHoursDay
  sat?: WorkingHoursDay
  sun?: WorkingHoursDay
}

export type Database = {
  public: {
    Tables: {
      account_role_permissions: {
        Row: {
          account_id: string
          created_at: string
          granted: boolean
          permission_id: string
          role_id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          granted: boolean
          permission_id: string
          role_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          granted?: boolean
          permission_id?: string
          role_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_role_permissions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          created_at: string
          id: string
          logo_url: string | null
          name: string
          owner_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          owner_id: string
        }
        Update: {
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          owner_id?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          account_id: string
          action_code: string
          created_at: string
          details: Json
          entity_id: string | null
          entity_type: string
          id: string
          ip_address: unknown
          legal_entity_id: string | null
          user_agent: string | null
          user_id: string | null
          venue_id: string | null
        }
        Insert: {
          account_id: string
          action_code: string
          created_at?: string
          details?: Json
          entity_id?: string | null
          entity_type: string
          id?: string
          ip_address?: unknown
          legal_entity_id?: string | null
          user_agent?: string | null
          user_id?: string | null
          venue_id?: string | null
        }
        Update: {
          account_id?: string
          action_code?: string
          created_at?: string
          details?: Json
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip_address?: unknown
          legal_entity_id?: string | null
          user_agent?: string | null
          user_id?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      external_entity_links: {
        Row: {
          account_id: string
          created_at: string
          entity_type: string
          external_id: string
          id: string
          local_id: string
          local_table: string
          provider: string
        }
        Insert: {
          account_id: string
          created_at?: string
          entity_type: string
          external_id: string
          id?: string
          local_id: string
          local_table: string
          provider: string
        }
        Update: {
          account_id?: string
          created_at?: string
          entity_type?: string
          external_id?: string
          id?: string
          local_id?: string
          local_table?: string
          provider?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_entity_links_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      hall_layouts: {
        Row: {
          canvas_height: number
          canvas_width: number
          hall_id: string
          objects: Json
          updated_at: string
        }
        Insert: {
          canvas_height?: number
          canvas_width?: number
          hall_id: string
          objects?: Json
          updated_at?: string
        }
        Update: {
          canvas_height?: number
          canvas_width?: number
          hall_id?: string
          objects?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hall_layouts_hall_id_fkey"
            columns: ["hall_id"]
            isOneToOne: true
            referencedRelation: "venue_halls"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_connections: {
        Row: {
          account_id: string
          created_at: string
          created_by: string
          id: string
          last_tested_at: string | null
          login: string
          password_encrypted: string
          password_iv: string
          password_tag: string
          provider: string
          status: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by: string
          id?: string
          last_tested_at?: string | null
          login: string
          password_encrypted: string
          password_iv: string
          password_tag: string
          provider: string
          status?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string
          id?: string
          last_tested_at?: string | null
          login?: string
          password_encrypted?: string
          password_iv?: string
          password_tag?: string
          provider?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_connections_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_connections_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_external_snapshots: {
        Row: {
          account_id: string
          entity_type: string
          external_id: string
          fetched_at: string
          id: string
          payload: Json
          provider: string
        }
        Insert: {
          account_id: string
          entity_type: string
          external_id: string
          fetched_at?: string
          id?: string
          payload: Json
          provider: string
        }
        Update: {
          account_id?: string
          entity_type?: string
          external_id?: string
          fetched_at?: string
          id?: string
          payload?: Json
          provider?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_external_snapshots_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_import_runs: {
        Row: {
          account_id: string
          created_by: string
          error_text: string | null
          finished_at: string | null
          id: string
          provider: string
          selected_entities: string[]
          selected_external_venue_ids: string[]
          started_at: string
          status: string
          summary: Json
        }
        Insert: {
          account_id: string
          created_by: string
          error_text?: string | null
          finished_at?: string | null
          id?: string
          provider: string
          selected_entities: string[]
          selected_external_venue_ids?: string[]
          started_at?: string
          status: string
          summary?: Json
        }
        Update: {
          account_id?: string
          created_by?: string
          error_text?: string | null
          finished_at?: string | null
          id?: string
          provider?: string
          selected_entities?: string[]
          selected_external_venue_ids?: string[]
          started_at?: string
          status?: string
          summary?: Json
        }
        Relationships: [
          {
            foreignKeyName: "integration_import_runs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_import_runs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          role_id: string
          status: Database["public"]["Enums"]["invitation_status"]
          venue_id: string
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          role_id: string
          status?: Database["public"]["Enums"]["invitation_status"]
          venue_id: string
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          role_id?: string
          status?: Database["public"]["Enums"]["invitation_status"]
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_entities: {
        Row: {
          account_id: string
          accountant_name: string | null
          actual_address: string | null
          created_at: string
          created_by: string | null
          dadata_synced_at: string | null
          default_account_number: string | null
          default_bank_name: string | null
          default_bik: string | null
          default_corr_account: string | null
          director_name: string | null
          director_position: string | null
          email: string | null
          id: string
          inn: string | null
          is_active: boolean
          kpp: string | null
          legal_address: string | null
          legal_form: Database["public"]["Enums"]["legal_form_enum"]
          name: string
          ogrn: string | null
          okpo: string | null
          okved: string | null
          phone: string | null
          postal_address: string | null
          short_name: string | null
          signature_basis: string | null
          tax_system: Database["public"]["Enums"]["tax_system_enum"] | null
          updated_at: string | null
          updated_by: string | null
          vat_payer: boolean
          website: string | null
        }
        Insert: {
          account_id: string
          accountant_name?: string | null
          actual_address?: string | null
          created_at?: string
          created_by?: string | null
          dadata_synced_at?: string | null
          default_account_number?: string | null
          default_bank_name?: string | null
          default_bik?: string | null
          default_corr_account?: string | null
          director_name?: string | null
          director_position?: string | null
          email?: string | null
          id?: string
          inn?: string | null
          is_active?: boolean
          kpp?: string | null
          legal_address?: string | null
          legal_form: Database["public"]["Enums"]["legal_form_enum"]
          name: string
          ogrn?: string | null
          okpo?: string | null
          okved?: string | null
          phone?: string | null
          postal_address?: string | null
          short_name?: string | null
          signature_basis?: string | null
          tax_system?: Database["public"]["Enums"]["tax_system_enum"] | null
          updated_at?: string | null
          updated_by?: string | null
          vat_payer?: boolean
          website?: string | null
        }
        Update: {
          account_id?: string
          accountant_name?: string | null
          actual_address?: string | null
          created_at?: string
          created_by?: string | null
          dadata_synced_at?: string | null
          default_account_number?: string | null
          default_bank_name?: string | null
          default_bik?: string | null
          default_corr_account?: string | null
          director_name?: string | null
          director_position?: string | null
          email?: string | null
          id?: string
          inn?: string | null
          is_active?: boolean
          kpp?: string | null
          legal_address?: string | null
          legal_form?: Database["public"]["Enums"]["legal_form_enum"]
          name?: string
          ogrn?: string | null
          okpo?: string | null
          okved?: string | null
          phone?: string | null
          postal_address?: string | null
          short_name?: string | null
          signature_basis?: string | null
          tax_system?: Database["public"]["Enums"]["tax_system_enum"] | null
          updated_at?: string | null
          updated_by?: string | null
          vat_payer?: boolean
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "legal_entities_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_entities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_entities_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          link: string | null
          read: boolean
          title: string
          type: string
          user_id: string
          venue_id: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read?: boolean
          title: string
          type?: string
          user_id: string
          venue_id?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read?: boolean
          title?: string
          type?: string
          user_id?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          code: string
          description: string
          id: string
          module: string
        }
        Insert: {
          code: string
          description: string
          id?: string
          module: string
        }
        Update: {
          code?: string
          description?: string
          id?: string
          module?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active_venue_id: string | null
          address: string | null
          avatar_url: string | null
          birth_date: string | null
          comment: string | null
          created_at: string
          employment_date: string | null
          first_name: string | null
          gender: string | null
          id: string
          last_name: string | null
          medical_book_date: string | null
          medical_book_number: string | null
          passport_photos: string[] | null
          phone: string | null
          photo_url: string | null
          telegram_id: string | null
          terminal_pin: string | null
        }
        Insert: {
          active_venue_id?: string | null
          address?: string | null
          avatar_url?: string | null
          birth_date?: string | null
          comment?: string | null
          created_at?: string
          employment_date?: string | null
          first_name?: string | null
          gender?: string | null
          id: string
          last_name?: string | null
          medical_book_date?: string | null
          medical_book_number?: string | null
          passport_photos?: string[] | null
          phone?: string | null
          photo_url?: string | null
          telegram_id?: string | null
          terminal_pin?: string | null
        }
        Update: {
          active_venue_id?: string | null
          address?: string | null
          avatar_url?: string | null
          birth_date?: string | null
          comment?: string | null
          created_at?: string
          employment_date?: string | null
          first_name?: string | null
          gender?: string | null
          id?: string
          last_name?: string | null
          medical_book_date?: string | null
          medical_book_number?: string | null
          passport_photos?: string[] | null
          phone?: string | null
          photo_url?: string | null
          telegram_id?: string | null
          terminal_pin?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_active_venue_id_fkey"
            columns: ["active_venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          granted: boolean
          permission_id: string
          role_id: string
        }
        Insert: {
          granted?: boolean
          permission_id: string
          role_id: string
        }
        Update: {
          granted?: boolean
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          account_id: string | null
          code: string
          comment: string | null
          id: string
          name: string
        }
        Insert: {
          account_id?: string | null
          code: string
          comment?: string | null
          id?: string
          name: string
        }
        Update: {
          account_id?: string | null
          code?: string
          comment?: string | null
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "roles_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      user_venue_roles: {
        Row: {
          created_at: string
          fired_at: string | null
          id: string
          invited_by: string | null
          role_id: string
          status: string
          user_id: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          fired_at?: string | null
          id?: string
          invited_by?: string | null
          role_id: string
          status?: string
          user_id: string
          venue_id: string
        }
        Update: {
          created_at?: string
          fired_at?: string | null
          id?: string
          invited_by?: string | null
          role_id?: string
          status?: string
          user_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_venue_roles_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_venue_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_venue_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_venue_roles_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_halls: {
        Row: {
          created_at: string
          id: string
          name: string
          sort_order: number
          updated_at: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
          venue_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_halls_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          account_id: string
          address: string | null
          comment: string | null
          created_at: string
          currency: string
          default_legal_entity_id: string | null
          id: string
          logo_url: string | null
          name: string
          phone: string | null
          timezone: string
          type: Database["public"]["Enums"]["venue_type"]
          website: string | null
          working_hours: Json | null
        }
        Insert: {
          account_id: string
          address?: string | null
          comment?: string | null
          created_at?: string
          currency?: string
          default_legal_entity_id?: string | null
          id?: string
          logo_url?: string | null
          name: string
          phone?: string | null
          timezone?: string
          type?: Database["public"]["Enums"]["venue_type"]
          website?: string | null
          working_hours?: Json | null
        }
        Update: {
          account_id?: string
          address?: string | null
          comment?: string | null
          created_at?: string
          currency?: string
          default_legal_entity_id?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          phone?: string | null
          timezone?: string
          type?: Database["public"]["Enums"]["venue_type"]
          website?: string | null
          working_hours?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "venues_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venues_default_legal_entity_id_fkey"
            columns: ["default_legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invitation: {
        Args: { p_invitation_id: string }
        Returns: undefined
      }
      complete_owner_onboarding:
        | {
            Args: {
              p_account_logo: string
              p_account_name: string
              p_currency?: string
              p_legal_form: Database["public"]["Enums"]["legal_form_enum"]
              p_legal_inn: string
              p_legal_name: string
              p_timezone?: string
              p_venue_address: string
              p_venue_name: string
              p_venue_phone: string
              p_venue_type: Database["public"]["Enums"]["venue_type"]
              p_venue_website?: string
              p_working_hours?: Json
            }
            Returns: Json
          }
        | {
            Args: {
              p_account_logo: string
              p_account_name: string
              p_currency: string
              p_timezone: string
              p_venue_address: string
              p_venue_name: string
              p_venue_phone: string
              p_venue_type: Database["public"]["Enums"]["venue_type"]
              p_working_hours: Json
            }
            Returns: Json
          }
      get_active_account_id: { Args: never; Returns: string }
      get_active_legal_entity_id: { Args: never; Returns: string }
      get_active_venue_id: { Args: never; Returns: string }
      get_effective_role_permissions: {
        Args: { p_role_ids?: string[] }
        Returns: {
          granted: boolean
          permission_id: string
          role_id: string
        }[]
      }
      get_fired_staff: {
        Args: { p_venue_id: string }
        Returns: {
          avatar_url: string
          email: string
          fired_at: string
          first_name: string
          last_name: string
          role_code: string
          role_id: string
          role_name: string
          user_id: string
          uvr_id: string
        }[]
      }
      get_user_venues: {
        Args: never
        Returns: {
          role_code: string
          role_name: string
          venue_id: string
          venue_name: string
        }[]
      }
      get_venue_staff: {
        Args: { p_venue_id: string }
        Returns: {
          avatar_url: string
          birth_date: string
          email: string
          employment_date: string
          first_name: string
          gender: string
          joined_at: string
          last_name: string
          phone: string
          role_code: string
          role_id: string
          role_name: string
          telegram_id: string
          user_id: string
          uvr_id: string
        }[]
      }
      has_permission: { Args: { permission_code: string }; Returns: boolean }
      is_account_owner: { Args: { p_account_id: string }; Returns: boolean }
      log_audit: {
        Args: {
          p_action_code: string
          p_details?: Json
          p_entity_id: string
          p_entity_type: string
        }
        Returns: undefined
      }
      set_effective_role_permission: {
        Args: { p_granted: boolean; p_permission_id: string; p_role_id: string }
        Returns: undefined
      }
    }
    Enums: {
      invitation_status: "pending" | "accepted" | "expired"
      legal_form_enum: "IP" | "OOO" | "AO" | "PAO" | "NKO" | "OTHER"
      tax_system_enum:
        | "OSN"
        | "USN_INCOME"
        | "USN_INCOME_EXPENSE"
        | "PSN"
        | "NPD"
        | "AUSN"
      venue_type:
        | "restaurant"
        | "bar"
        | "cafe"
        | "club"
        | "other"
        | "snack_bar"
        | "hookah"
        | "pastry_shop"
        | "coffee_shop"
        | "pub"
        | "pizzeria"
        | "canteen"
        | "fast_food"
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

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      invitation_status: ["pending", "accepted", "expired"],
      legal_form_enum: ["IP", "OOO", "AO", "PAO", "NKO", "OTHER"],
      tax_system_enum: [
        "OSN",
        "USN_INCOME",
        "USN_INCOME_EXPENSE",
        "PSN",
        "NPD",
        "AUSN",
      ],
      venue_type: [
        "restaurant",
        "bar",
        "cafe",
        "club",
        "other",
        "snack_bar",
        "hookah",
        "pastry_shop",
        "coffee_shop",
        "pub",
        "pizzeria",
        "canteen",
        "fast_food",
      ],
    },
  },
} as const

// Convenience aliases
export type VenueType        = Database["public"]["Enums"]["venue_type"]
export type InvitationStatus = Database["public"]["Enums"]["invitation_status"]
export type LegalForm        = Database["public"]["Enums"]["legal_form_enum"]
export type TaxSystem        = Database["public"]["Enums"]["tax_system_enum"]
