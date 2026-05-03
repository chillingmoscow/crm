export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      account_files: {
        Row: {
          account_id: string
          id: string
          mime_type: string
          name: string
          size_bytes: number
          storage_path: string
          uploaded_at: string
          uploaded_by: string
        }
        Insert: {
          account_id: string
          id?: string
          mime_type: string
          name: string
          size_bytes: number
          storage_path: string
          uploaded_at?: string
          uploaded_by: string
        }
        Update: {
          account_id?: string
          id?: string
          mime_type?: string
          name?: string
          size_bytes?: number
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_files_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_files_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      account_hidden_roles: {
        Row: {
          account_id: string
          hidden_at: string
          hidden_by: string | null
          role_id: string
        }
        Insert: {
          account_id: string
          hidden_at?: string
          hidden_by?: string | null
          role_id: string
        }
        Update: {
          account_id?: string
          hidden_at?: string
          hidden_by?: string | null
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_hidden_roles_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_hidden_roles_hidden_by_fkey"
            columns: ["hidden_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_hidden_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
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
      bank_account_groups: {
        Row: {
          account_id: string
          created_at: string
          description: string | null
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          account_id: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          account_id?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "bank_account_groups_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_accounts: {
        Row: {
          account_id: string
          account_number: string | null
          acquiring_percentage: number | null
          balance: number
          bank_name: string | null
          bik: string | null
          card_holder: string | null
          card_number_last4: string | null
          correspondent_account: string | null
          created_at: string
          created_by: string | null
          currency: string
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          group_id: string | null
          id: string
          is_active: boolean
          legal_entity_id: string
          name: string
          type: Database["public"]["Enums"]["bank_account_type_enum"]
          updated_at: string | null
          updated_by: string | null
          venue_id: string | null
        }
        Insert: {
          account_id: string
          account_number?: string | null
          acquiring_percentage?: number | null
          balance?: number
          bank_name?: string | null
          bik?: string | null
          card_holder?: string | null
          card_number_last4?: string | null
          correspondent_account?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          group_id?: string | null
          id?: string
          is_active?: boolean
          legal_entity_id: string
          name: string
          type: Database["public"]["Enums"]["bank_account_type_enum"]
          updated_at?: string | null
          updated_by?: string | null
          venue_id?: string | null
        }
        Update: {
          account_id?: string
          account_number?: string | null
          acquiring_percentage?: number | null
          balance?: number
          bank_name?: string | null
          bik?: string | null
          card_holder?: string | null
          card_number_last4?: string | null
          correspondent_account?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          group_id?: string | null
          id?: string
          is_active?: boolean
          legal_entity_id?: string
          name?: string
          type?: Database["public"]["Enums"]["bank_account_type_enum"]
          updated_at?: string | null
          updated_by?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_accounts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_accounts_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_accounts_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "bank_account_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_accounts_legal_entity_tenant_fkey"
            columns: ["account_id", "legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "bank_accounts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_accounts_venue_tenant_fkey"
            columns: ["account_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["account_id", "id"]
          },
        ]
      }
      counterparties: {
        Row: {
          account_id: string
          address: string | null
          contact_person: string | null
          created_at: string
          created_by: string | null
          dadata_synced_at: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          email: string | null
          group_id: string | null
          id: string
          inn: string | null
          is_active: boolean
          kpp: string | null
          legal_form: Database["public"]["Enums"]["legal_form_enum"]
          name: string
          ogrn: string | null
          phone: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          account_id: string
          address?: string | null
          contact_person?: string | null
          created_at?: string
          created_by?: string | null
          dadata_synced_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          email?: string | null
          group_id?: string | null
          id?: string
          inn?: string | null
          is_active?: boolean
          kpp?: string | null
          legal_form?: Database["public"]["Enums"]["legal_form_enum"]
          name: string
          ogrn?: string | null
          phone?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          account_id?: string
          address?: string | null
          contact_person?: string | null
          created_at?: string
          created_by?: string | null
          dadata_synced_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          email?: string | null
          group_id?: string | null
          id?: string
          inn?: string | null
          is_active?: boolean
          kpp?: string | null
          legal_form?: Database["public"]["Enums"]["legal_form_enum"]
          name?: string
          ogrn?: string | null
          phone?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "counterparties_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "counterparties_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "counterparties_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "counterparties_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "counterparty_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "counterparties_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      counterparty_attachments: {
        Row: {
          counterparty_id: string
          description: string | null
          document_date: string | null
          document_number: string | null
          document_type: Database["public"]["Enums"]["attachment_document_type_enum"]
          file_id: string
        }
        Insert: {
          counterparty_id: string
          description?: string | null
          document_date?: string | null
          document_number?: string | null
          document_type?: Database["public"]["Enums"]["attachment_document_type_enum"]
          file_id: string
        }
        Update: {
          counterparty_id?: string
          description?: string | null
          document_date?: string | null
          document_number?: string | null
          document_type?: Database["public"]["Enums"]["attachment_document_type_enum"]
          file_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "counterparty_attachments_counterparty_id_fkey"
            columns: ["counterparty_id"]
            isOneToOne: false
            referencedRelation: "counterparties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "counterparty_attachments_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "account_files"
            referencedColumns: ["id"]
          },
        ]
      }
      counterparty_groups: {
        Row: {
          account_id: string
          created_at: string
          description: string | null
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          account_id: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          account_id?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "counterparty_groups_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
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
      finance_categories: {
        Row: {
          account_id: string
          color: string | null
          created_at: string
          created_by: string | null
          description: string | null
          group_id: string | null
          icon: string | null
          id: string
          is_active: boolean
          is_system: boolean
          name: string
          sort_order: number
          type: Database["public"]["Enums"]["finance_category_type_enum"]
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          account_id: string
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          group_id?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          name: string
          sort_order?: number
          type: Database["public"]["Enums"]["finance_category_type_enum"]
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          account_id?: string
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          group_id?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          name?: string
          sort_order?: number
          type?: Database["public"]["Enums"]["finance_category_type_enum"]
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_categories_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_categories_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_categories_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "finance_category_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_categories_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_category_groups: {
        Row: {
          account_id: string
          created_at: string
          id: string
          name: string
          sort_order: number
          type: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          type?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_category_groups_account_id_fkey"
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
      kb_page_attachments: {
        Row: {
          attached_at: string
          attached_by: string | null
          caption: string | null
          file_id: string
          page_id: string
        }
        Insert: {
          attached_at?: string
          attached_by?: string | null
          caption?: string | null
          file_id: string
          page_id: string
        }
        Update: {
          attached_at?: string
          attached_by?: string | null
          caption?: string | null
          file_id?: string
          page_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kb_page_attachments_attached_by_fkey"
            columns: ["attached_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_page_attachments_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "account_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_page_attachments_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "kb_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_page_links: {
        Row: {
          account_id: string
          from_page_id: string
          to_page_id: string
        }
        Insert: {
          account_id: string
          from_page_id: string
          to_page_id: string
        }
        Update: {
          account_id?: string
          from_page_id?: string
          to_page_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kb_page_links_from_page_id_fkey"
            columns: ["from_page_id"]
            isOneToOne: false
            referencedRelation: "kb_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_page_links_from_tenant_fkey"
            columns: ["account_id", "from_page_id"]
            isOneToOne: false
            referencedRelation: "kb_pages"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "kb_page_links_to_page_id_fkey"
            columns: ["to_page_id"]
            isOneToOne: false
            referencedRelation: "kb_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_page_links_to_tenant_fkey"
            columns: ["account_id", "to_page_id"]
            isOneToOne: false
            referencedRelation: "kb_pages"
            referencedColumns: ["account_id", "id"]
          },
        ]
      }
      kb_page_versions: {
        Row: {
          account_id: string
          change_note: string | null
          content: Json
          created_at: string
          created_by: string | null
          id: string
          page_id: string
          title: string
          version_number: number
        }
        Insert: {
          account_id: string
          change_note?: string | null
          content: Json
          created_at?: string
          created_by?: string | null
          id?: string
          page_id: string
          title: string
          version_number: number
        }
        Update: {
          account_id?: string
          change_note?: string | null
          content?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          page_id?: string
          title?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "kb_page_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_page_versions_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "kb_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_page_versions_page_tenant_fkey"
            columns: ["account_id", "page_id"]
            isOneToOne: false
            referencedRelation: "kb_pages"
            referencedColumns: ["account_id", "id"]
          },
        ]
      }
      kb_pages: {
        Row: {
          account_id: string
          content: Json
          cover_url: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          deleted_root_id: string | null
          icon: string | null
          icon_color: string | null
          id: string
          parent_id: string | null
          plain_text: string
          position: number
          search_tsv: unknown
          slug: string
          title: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          account_id: string
          content?: Json
          cover_url?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_root_id?: string | null
          icon?: string | null
          icon_color?: string | null
          id?: string
          parent_id?: string | null
          plain_text?: string
          position?: number
          search_tsv?: unknown
          slug: string
          title?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          account_id?: string
          content?: Json
          cover_url?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_root_id?: string | null
          icon?: string | null
          icon_color?: string | null
          id?: string
          parent_id?: string | null
          plain_text?: string
          position?: number
          search_tsv?: unknown
          slug?: string
          title?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kb_pages_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_pages_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_pages_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_pages_parent_tenant_fkey"
            columns: ["account_id", "parent_id"]
            isOneToOne: false
            referencedRelation: "kb_pages"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "kb_pages_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      legal_entity_attachments: {
        Row: {
          description: string | null
          document_type: Database["public"]["Enums"]["attachment_document_type_enum"]
          file_id: string
          legal_entity_id: string
        }
        Insert: {
          description?: string | null
          document_type?: Database["public"]["Enums"]["attachment_document_type_enum"]
          file_id: string
          legal_entity_id: string
        }
        Update: {
          description?: string | null
          document_type?: Database["public"]["Enums"]["attachment_document_type_enum"]
          file_id?: string
          legal_entity_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_entity_attachments_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "account_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_entity_attachments_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
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
          created_at: string
          created_by: string | null
          icon: string | null
          id: string
          name: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_id?: string | null
          code: string
          comment?: string | null
          created_at?: string
          created_by?: string | null
          icon?: string | null
          id?: string
          name: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_id?: string | null
          code?: string
          comment?: string | null
          created_at?: string
          created_by?: string | null
          icon?: string | null
          id?: string
          name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roles_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roles_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_attachments: {
        Row: {
          document_type: Database["public"]["Enums"]["attachment_document_type_enum"]
          file_id: string
          transaction_id: string
        }
        Insert: {
          document_type?: Database["public"]["Enums"]["attachment_document_type_enum"]
          file_id: string
          transaction_id: string
        }
        Update: {
          document_type?: Database["public"]["Enums"]["attachment_document_type_enum"]
          file_id?: string
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_attachments_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "account_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_attachments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          account_id: string
          amount: number
          bank_account_id: string
          category_id: string | null
          counterparty_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          date: string
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          id: string
          legal_entity_id: string
          public_id: number
          source: Database["public"]["Enums"]["transaction_source_enum"]
          source_external_id: string | null
          to_bank_account_id: string | null
          to_legal_entity_id: string | null
          type: Database["public"]["Enums"]["transaction_type_enum"]
          updated_at: string | null
          updated_by: string | null
          venue_id: string | null
        }
        Insert: {
          account_id: string
          amount: number
          bank_account_id: string
          category_id?: string | null
          counterparty_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          date: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          legal_entity_id: string
          public_id?: number
          source?: Database["public"]["Enums"]["transaction_source_enum"]
          source_external_id?: string | null
          to_bank_account_id?: string | null
          to_legal_entity_id?: string | null
          type: Database["public"]["Enums"]["transaction_type_enum"]
          updated_at?: string | null
          updated_by?: string | null
          venue_id?: string | null
        }
        Update: {
          account_id?: string
          amount?: number
          bank_account_id?: string
          category_id?: string | null
          counterparty_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          date?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          legal_entity_id?: string
          public_id?: number
          source?: Database["public"]["Enums"]["transaction_source_enum"]
          source_external_id?: string | null
          to_bank_account_id?: string | null
          to_legal_entity_id?: string | null
          type?: Database["public"]["Enums"]["transaction_type_enum"]
          updated_at?: string | null
          updated_by?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_bank_account_tenant_fkey"
            columns: ["account_id", "bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "transactions_category_tenant_fkey"
            columns: ["account_id", "category_id"]
            isOneToOne: false
            referencedRelation: "finance_categories"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "transactions_counterparty_tenant_fkey"
            columns: ["account_id", "counterparty_id"]
            isOneToOne: false
            referencedRelation: "counterparties"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "transactions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_legal_entity_tenant_fkey"
            columns: ["account_id", "legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "transactions_to_bank_account_tenant_fkey"
            columns: ["account_id", "to_bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "transactions_to_legal_entity_tenant_fkey"
            columns: ["account_id", "to_legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["account_id", "id"]
          },
          {
            foreignKeyName: "transactions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_venue_tenant_fkey"
            columns: ["account_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["account_id", "id"]
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
            foreignKeyName: "venues_default_legal_entity_tenant_fkey"
            columns: ["account_id", "default_legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["account_id", "id"]
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
      apply_transaction_balance_delta: {
        Args: { p_bank_account_id: string; p_delta: number }
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
      copy_role_permissions: {
        Args: { p_source_role_id: string; p_target_role_id: string }
        Returns: undefined
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
          venue_type: string
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
      hide_system_role: { Args: { p_role_id: string }; Returns: undefined }
      is_account_owner: { Args: { p_account_id: string }; Returns: boolean }
      kb_get_ancestors: {
        Args: { p_page_id: string }
        Returns: {
          depth: number
          icon: string
          icon_color: string
          id: string
          slug: string
          title: string
        }[]
      }
      kb_list_account_members: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          first_name: string
          id: string
          last_name: string
        }[]
      }
      kb_reorder_siblings: {
        Args: { p_parent_id: string | null; p_ordered_ids: string[] }
        Returns: number
      }
      kb_restore_cascade: { Args: { p_id: string }; Returns: number }
      kb_save_page: {
        Args: {
          p_content: Json
          p_icon: string
          p_icon_color: string
          p_id: string
          p_link_targets: string[]
          p_plain_text: string
          p_title: string
        }
        Returns: number
      }
      kb_search: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          icon: string
          icon_color: string
          id: string
          rank: number
          slug: string
          snippet: string
          title: string
        }[]
      }
      kb_soft_delete_cascade: { Args: { p_id: string }; Returns: number }
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
      attachment_document_type_enum:
        | "receipt"
        | "contract"
        | "act"
        | "invoice"
        | "waybill"
        | "tax_document"
        | "registration_doc"
        | "other"
      bank_account_type_enum:
        | "checking"
        | "debit_card"
        | "cash"
        | "fund"
        | "safe"
      finance_category_type_enum: "income" | "expense"
      invitation_status: "pending" | "accepted" | "expired"
      legal_form_enum: "IP" | "OOO" | "AO" | "PAO" | "NKO" | "OTHER"
      tax_system_enum:
        | "OSN"
        | "USN_INCOME"
        | "USN_INCOME_EXPENSE"
        | "PSN"
        | "NPD"
        | "AUSN"
      transaction_source_enum: "manual" | "quickresto" | "import" | "bank_sync"
      transaction_type_enum: "income" | "expense" | "transfer"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      attachment_document_type_enum: [
        "receipt",
        "contract",
        "act",
        "invoice",
        "waybill",
        "tax_document",
        "registration_doc",
        "other",
      ],
      bank_account_type_enum: [
        "checking",
        "debit_card",
        "cash",
        "fund",
        "safe",
      ],
      finance_category_type_enum: ["income", "expense"],
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
      transaction_source_enum: ["manual", "quickresto", "import", "bank_sync"],
      transaction_type_enum: ["income", "expense", "transfer"],
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

// ─── Hand-added enum aliases ─────────────────────────────────────────────────
export type VenueType        = Database["public"]["Enums"]["venue_type"]
export type InvitationStatus = Database["public"]["Enums"]["invitation_status"]
export type LegalForm        = Database["public"]["Enums"]["legal_form_enum"]
export type TaxSystem        = Database["public"]["Enums"]["tax_system_enum"]
export type BankAccountType  = Database["public"]["Enums"]["bank_account_type_enum"]
export type FinanceCategoryType = Database["public"]["Enums"]["finance_category_type_enum"]
export type TransactionType  = Database["public"]["Enums"]["transaction_type_enum"]
export type TransactionSource = Database["public"]["Enums"]["transaction_source_enum"]
export type AttachmentDocumentType = Database["public"]["Enums"]["attachment_document_type_enum"]
