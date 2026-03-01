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
        Relationships: [
          {
            foreignKeyName: "accounts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      account_role_permissions: {
        Row: {
          account_id: string
          granted: boolean
          permission_id: string
          role_id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          granted?: boolean
          permission_id: string
          role_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string
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
            foreignKeyName: "invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
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
          passport_photos: string[]
          phone: string | null
          photo_url: string | null
          telegram_id: string | null
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
          passport_photos?: string[]
          phone?: string | null
          photo_url?: string | null
          telegram_id?: string | null
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
          passport_photos?: string[]
          phone?: string | null
          photo_url?: string | null
          telegram_id?: string | null
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
      venues: {
        Row: {
          account_id: string
          address: string | null
          comment: string | null
          created_at: string
          currency: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invitation: {
        Args: { p_invitation_id: string }
        Returns: undefined
      }
      complete_owner_onboarding: {
        Args: {
          p_account_logo: string
          p_account_name: string
          p_currency: string
          p_timezone: string
          p_venue_address: string
          p_venue_name: string
          p_venue_phone: string
          p_venue_type: Database["public"]["Enums"]["venue_type"]
          p_venue_website?: string
          p_working_hours: Json
        }
        Returns: Json
      }
      get_active_account_id: {
        Args: never
        Returns: string | null
      }
      get_active_venue_id: {
        Args: never
        Returns: string | null
      }
      get_effective_role_permissions: {
        Args: { p_role_ids?: string[] | null }
        Returns: {
          granted: boolean
          permission_id: string
          role_id: string
        }[]
      }
      get_fired_staff: {
        Args: { p_venue_id: string }
        Returns: {
          avatar_url: string | null
          email: string
          fired_at: string | null
          first_name: string | null
          last_name: string | null
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
          avatar_url: string | null
          birth_date: string | null
          email: string
          employment_date: string | null
          first_name: string | null
          gender: string | null
          joined_at: string
          last_name: string | null
          phone: string | null
          role_code: string
          role_id: string
          role_name: string
          telegram_id: string | null
          user_id: string
          uvr_id: string
        }[]
      }
      has_permission: {
        Args: { permission_code: string }
        Returns: boolean
      }
      set_effective_role_permission: {
        Args: {
          p_granted: boolean
          p_permission_id: string
          p_role_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      invitation_status: "pending" | "accepted" | "expired"
      venue_type: "restaurant" | "bar" | "cafe" | "club" | "other" | "snack_bar" | "hookah" | "pastry_shop" | "coffee_shop" | "pub" | "pizzeria" | "canteen" | "fast_food"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// Convenience aliases
export type VenueType = Database["public"]["Enums"]["venue_type"]
export type InvitationStatus = Database["public"]["Enums"]["invitation_status"]
