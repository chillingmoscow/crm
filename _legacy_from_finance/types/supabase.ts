export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      accounts: {
        Row: {
          id: string
          name: string
          balance: number
          currency: string
          description: string | null
          group_name: string | null
          account_type: string
          bank_name: string | null
          bik: string | null
          account_number: string | null
          correspondent_account: string | null
          acquiring_percentage: number | null
          card_holder: string | null
          card_number: string | null
          created_by: string
          created_at: string
          updated_by: string | null
          updated_at: string | null
          deleted_by: string | null
          deleted_at: string | null
        }
        Insert: {
          id?: string
          name: string
          balance?: number
          currency: string
          description?: string | null
          group_name?: string | null
          account_type?: string
          bank_name?: string | null
          bik?: string | null
          account_number?: string | null
          correspondent_account?: string | null
          acquiring_percentage?: number | null
          card_holder?: string | null
          card_number?: string | null
          created_by: string
          created_at?: string
          updated_by?: string | null
          updated_at?: string | null
          deleted_by?: string | null
          deleted_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          balance?: number
          currency?: string
          description?: string | null
          group_name?: string | null
          account_type?: string
          bank_name?: string | null
          bik?: string | null
          account_number?: string | null
          correspondent_account?: string | null
          acquiring_percentage?: number | null
          card_holder?: string | null
          card_number?: string | null
          created_by?: string
          created_at?: string
          updated_by?: string | null
          updated_at?: string | null
          deleted_by?: string | null
          deleted_at?: string | null
        }
      }
      audit_logs: {
        Row: {
          id: string
          timestamp: string
          user_id: string
          action: string
          entity_type: string
          entity_id: string
          details: string
        }
        Insert: {
          id?: string
          timestamp?: string
          user_id: string
          action: string
          entity_type: string
          entity_id: string
          details: string
        }
        Update: {
          id?: string
          timestamp?: string
          user_id?: string
          action?: string
          entity_type?: string
          entity_id?: string
          details?: string
        }
      }
      attached_files: {
        Row: {
          id: string
          name: string
          type: string
          size: number
          url: string
          thumbnail_url: string | null
          uploaded_at: string
          uploaded_by: string
        }
        Insert: {
          id?: string
          name: string
          type: string
          size: number
          url: string
          thumbnail_url?: string | null
          uploaded_at?: string
          uploaded_by: string
        }
        Update: {
          id?: string
          name?: string
          type?: string
          size?: number
          url?: string
          thumbnail_url?: string | null
          uploaded_at?: string
          uploaded_by?: string
        }
      }
      categories: {
        Row: {
          id: string
          name: string
          type: string
          description: string | null
          color: string | null
          created_by: string
          created_at: string
          updated_by: string | null
          updated_at: string | null
          deleted_by: string | null
          deleted_at: string | null
        }
        Insert: {
          id?: string
          name: string
          type: string
          description?: string | null
          color?: string | null
          created_by: string
          created_at?: string
          updated_by?: string | null
          updated_at?: string | null
          deleted_by?: string | null
          deleted_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          type?: string
          description?: string | null
          color?: string | null
          created_by?: string
          created_at?: string
          updated_by?: string | null
          updated_at?: string | null
          deleted_by?: string | null
          deleted_at?: string | null
        }
      }
      counterparties: {
        Row: {
          id: string
          name: string
          legal_entity: string
          inn: string | null
          contact_person: string | null
          phone: string | null
          email: string | null
          description: string | null
          created_by: string
          created_at: string
          updated_by: string | null
          updated_at: string | null
          deleted_by: string | null
          deleted_at: string | null
        }
        Insert: {
          id?: string
          name: string
          legal_entity: string
          inn?: string | null
          contact_person?: string | null
          phone?: string | null
          email?: string | null
          description?: string | null
          created_by: string
          created_at?: string
          updated_by?: string | null
          updated_at?: string | null
          deleted_by?: string | null
          deleted_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          legal_entity?: string
          inn?: string | null
          contact_person?: string | null
          phone?: string | null
          email?: string | null
          description?: string | null
          created_by?: string
          created_at?: string
          updated_by?: string | null
          updated_at?: string | null
          deleted_by?: string | null
          deleted_at?: string | null
        }
      }
      transaction_attachments: {
        Row: {
          transaction_id: string
          file_id: string
        }
        Insert: {
          transaction_id: string
          file_id: string
        }
        Update: {
          transaction_id?: string
          file_id?: string
        }
      }
      transactions: {
        Row: {
          id: string
          amount: number
          currency: string
          account_id: string
          category_id: string | null
          counterparty_id: string | null
          description: string
          date: string
          type: string
          to_account_id: string | null
          to_amount: number | null
          to_currency: string | null
          created_by: string
          created_at: string
          updated_by: string | null
          updated_at: string | null
          deleted_by: string | null
          deleted_at: string | null
        }
        Insert: {
          id?: string
          amount: number
          currency: string
          account_id: string
          category_id?: string | null
          counterparty_id?: string | null
          description: string
          date: string
          type: string
          to_account_id?: string | null
          to_amount?: number | null
          to_currency?: string | null
          created_by: string
          created_at?: string
          updated_by?: string | null
          updated_at?: string | null
          deleted_by?: string | null
          deleted_at?: string | null
        }
        Update: {
          id?: string
          amount?: number
          currency?: string
          account_id?: string
          category_id?: string | null
          counterparty_id?: string | null
          description?: string
          date?: string
          type?: string
          to_account_id?: string | null
          to_amount?: number | null
          to_currency?: string | null
          created_by?: string
          created_at?: string
          updated_by?: string | null
          updated_at?: string | null
          deleted_by?: string | null
          deleted_at?: string | null
        }
      }
      users: {
        Row: {
          id: string
          full_name: string
          email: string
          role: string
          avatar: string | null
          created_at: string
          is_active: boolean
        }
        Insert: {
          id?: string
          full_name: string
          email: string
          role: string
          avatar?: string | null
          created_at?: string
          is_active?: boolean
        }
        Update: {
          id?: string
          full_name?: string
          email?: string
          role?: string
          avatar?: string | null
          created_at?: string
          is_active?: boolean
        }
      }
    }
    Views: {
      statistics: {
        Row: {
          total_income: number | null
          total_expense: number | null
          balance: number | null
          income_by_category: Json | null
          expense_by_category: Json | null
        }
        Insert: {
          total_income?: never
          total_expense?: never
          balance?: never
          income_by_category?: never
          expense_by_category?: never
        }
        Update: {
          total_income?: never
          total_expense?: never
          balance?: never
          income_by_category?: never
          expense_by_category?: never
        }
      }
    }
    Functions: {}
    Enums: {}
  }
} 