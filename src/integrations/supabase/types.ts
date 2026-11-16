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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          browser: string | null
          created_at: string
          device: string | null
          id: string
          ip_address: string | null
          location: string | null
          new_value: Json | null
          old_value: Json | null
          record_id: string | null
          role: string | null
          table_name: string | null
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          action: string
          browser?: string | null
          created_at?: string
          device?: string | null
          id?: string
          ip_address?: string | null
          location?: string | null
          new_value?: Json | null
          old_value?: Json | null
          record_id?: string | null
          role?: string | null
          table_name?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          action?: string
          browser?: string | null
          created_at?: string
          device?: string | null
          id?: string
          ip_address?: string | null
          location?: string | null
          new_value?: Json | null
          old_value?: Json | null
          record_id?: string | null
          role?: string | null
          table_name?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: []
      }
      bank_transfers: {
        Row: {
          account_name: string
          account_number: string
          admin_notes: string | null
          amount: number
          bank_code: string | null
          bank_name: string
          business_id: string | null
          confirmed_at: string | null
          created_at: string
          id: string
          invoice_id: string | null
          notes: string | null
          officer_id: string | null
          payment_id: string | null
          proof_document_url: string | null
          reviewed_by: string | null
          status: string
          submitted_at: string
          submitted_by: string | null
          transaction_reference: string
          updated_at: string
        }
        Insert: {
          account_name: string
          account_number: string
          admin_notes?: string | null
          amount: number
          bank_code?: string | null
          bank_name: string
          business_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          id?: string
          invoice_id?: string | null
          notes?: string | null
          officer_id?: string | null
          payment_id?: string | null
          proof_document_url?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_at?: string
          submitted_by?: string | null
          transaction_reference: string
          updated_at?: string
        }
        Update: {
          account_name?: string
          account_number?: string
          admin_notes?: string | null
          amount?: number
          bank_code?: string | null
          bank_name?: string
          business_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          id?: string
          invoice_id?: string | null
          notes?: string | null
          officer_id?: string | null
          payment_id?: string | null
          proof_document_url?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_at?: string
          submitted_by?: string | null
          transaction_reference?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_transfers_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transfers_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transfers_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "officers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transfers_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          business_name: string
          category: string | null
          created_at: string
          date_registered: string
          division: string | null
          email: string | null
          gps_lat: number | null
          gps_lng: number | null
          id: string
          owner_name: string | null
          phone: string | null
          photo_url: string | null
          physical_address: string | null
          registration_number: string | null
          status: string
          tin: string | null
        }
        Insert: {
          business_name: string
          category?: string | null
          created_at?: string
          date_registered?: string
          division?: string | null
          email?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          owner_name?: string | null
          phone?: string | null
          photo_url?: string | null
          physical_address?: string | null
          registration_number?: string | null
          status?: string
          tin?: string | null
        }
        Update: {
          business_name?: string
          category?: string | null
          created_at?: string
          date_registered?: string
          division?: string | null
          email?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          owner_name?: string | null
          phone?: string | null
          photo_url?: string | null
          physical_address?: string | null
          registration_number?: string | null
          status?: string
          tin?: string | null
        }
        Relationships: []
      }
      cash_handovers: {
        Row: {
          actual_amount: number
          collected_amount: number
          created_at: string
          device_id: string | null
          difference: number | null
          expected_amount: number
          handover_date: string
          id: string
          officer_id: string | null
          opening_balance: number
          signature_url: string | null
          status: string
          supervisor_id: string | null
        }
        Insert: {
          actual_amount?: number
          collected_amount?: number
          created_at?: string
          device_id?: string | null
          difference?: number | null
          expected_amount?: number
          handover_date?: string
          id?: string
          officer_id?: string | null
          opening_balance?: number
          signature_url?: string | null
          status?: string
          supervisor_id?: string | null
        }
        Update: {
          actual_amount?: number
          collected_amount?: number
          created_at?: string
          device_id?: string | null
          difference?: number | null
          expected_amount?: number
          handover_date?: string
          id?: string
          officer_id?: string | null
          opening_balance?: number
          signature_url?: string | null
          status?: string
          supervisor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_handovers_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "pos_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_handovers_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "officers"
            referencedColumns: ["id"]
          },
        ]
      }
      device_pairing_codes: {
        Row: {
          android_version: string | null
          approved_at: string | null
          approved_by: string | null
          approved_device_id: string | null
          code: string
          created_at: string
          device_type: string
          expires_at: string
          id: string
          imei: string | null
          manufacturer: string | null
          model: string | null
          requested_by_officer_id: string | null
          requested_by_user_id: string | null
          status: string
        }
        Insert: {
          android_version?: string | null
          approved_at?: string | null
          approved_by?: string | null
          approved_device_id?: string | null
          code: string
          created_at?: string
          device_type?: string
          expires_at?: string
          id?: string
          imei?: string | null
          manufacturer?: string | null
          model?: string | null
          requested_by_officer_id?: string | null
          requested_by_user_id?: string | null
          status?: string
        }
        Update: {
          android_version?: string | null
          approved_at?: string | null
          approved_by?: string | null
          approved_device_id?: string | null
          code?: string
          created_at?: string
          device_type?: string
          expires_at?: string
          id?: string
          imei?: string | null
          manufacturer?: string | null
          model?: string | null
          requested_by_officer_id?: string | null
          requested_by_user_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_pairing_codes_approved_device_id_fkey"
            columns: ["approved_device_id"]
            isOneToOne: false
            referencedRelation: "pos_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_pairing_codes_requested_by_officer_id_fkey"
            columns: ["requested_by_officer_id"]
            isOneToOne: false
            referencedRelation: "officers"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount: number
          assessment_number: string | null
          business_id: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          discount: number
          due_date: string | null
          financial_year: string | null
          id: string
          invoice_number: string
          issue_date: string
          issued_by: string | null
          notes: string | null
          paid_amount: number
          penalty: number
          qr_code: string | null
          status: string
          tax_type: string
        }
        Insert: {
          amount?: number
          assessment_number?: string | null
          business_id?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          discount?: number
          due_date?: string | null
          financial_year?: string | null
          id?: string
          invoice_number?: string
          issue_date?: string
          issued_by?: string | null
          notes?: string | null
          paid_amount?: number
          penalty?: number
          qr_code?: string | null
          status?: string
          tax_type: string
        }
        Update: {
          amount?: number
          assessment_number?: string | null
          business_id?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          discount?: number
          due_date?: string | null
          financial_year?: string | null
          id?: string
          invoice_number?: string
          issue_date?: string
          issued_by?: string | null
          notes?: string | null
          paid_amount?: number
          penalty?: number
          qr_code?: string | null
          status?: string
          tax_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          category: string | null
          created_at: string
          id: string
          is_read: boolean
          message: string | null
          title: string
          user_id: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string | null
          title: string
          user_id?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string | null
          title?: string
          user_id?: string | null
        }
        Relationships: []
      }
      officers: {
        Row: {
          collection_area: string | null
          created_at: string
          division: string | null
          email: string | null
          employee_id: string
          full_name: string
          handover_deadline: string | null
          id: string
          monthly_target: number | null
          phone: string | null
          photo_url: string | null
          pin: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          collection_area?: string | null
          created_at?: string
          division?: string | null
          email?: string | null
          employee_id: string
          full_name: string
          handover_deadline?: string | null
          id?: string
          monthly_target?: number | null
          phone?: string | null
          photo_url?: string | null
          pin?: string | null
          status?: string
          user_id?: string | null
        }
        Update: {
          collection_area?: string | null
          created_at?: string
          division?: string | null
          email?: string | null
          employee_id?: string
          full_name?: string
          handover_deadline?: string | null
          id?: string
          monthly_target?: number | null
          phone?: string | null
          photo_url?: string | null
          pin?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          business_id: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          device_id: string | null
          gps_lat: number | null
          gps_lng: number | null
          id: string
          invoice_id: string | null
          officer_id: string | null
          paid_at: string
          payment_method: string
          receipt_number: string
          reference_number: string | null
          status: string
          sync_status: string
        }
        Insert: {
          amount: number
          business_id?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          device_id?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          invoice_id?: string | null
          officer_id?: string | null
          paid_at?: string
          payment_method: string
          receipt_number?: string
          reference_number?: string | null
          status?: string
          sync_status?: string
        }
        Update: {
          amount?: number
          business_id?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          device_id?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          invoice_id?: string | null
          officer_id?: string | null
          paid_at?: string
          payment_method?: string
          receipt_number?: string
          reference_number?: string | null
          status?: string
          sync_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "pos_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "officers"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_devices: {
        Row: {
          android_version: string | null
          app_version: string | null
          assigned_officer_id: string | null
          battery_level: number | null
          cash_balance: number | null
          created_at: string
          current_lat: number | null
          current_lng: number | null
          device_type: string
          id: string
          imei: string | null
          last_seen: string | null
          lock_reason: string | null
          locked: boolean
          locked_at: string | null
          manufacturer: string | null
          model: string | null
          network_strength: string | null
          online_status: string
          serial_number: string
          sim_number: string | null
          status: string
          sync_status: string
          total_transactions: number | null
        }
        Insert: {
          android_version?: string | null
          app_version?: string | null
          assigned_officer_id?: string | null
          battery_level?: number | null
          cash_balance?: number | null
          created_at?: string
          current_lat?: number | null
          current_lng?: number | null
          device_type?: string
          id?: string
          imei?: string | null
          last_seen?: string | null
          lock_reason?: string | null
          locked?: boolean
          locked_at?: string | null
          manufacturer?: string | null
          model?: string | null
          network_strength?: string | null
          online_status?: string
          serial_number: string
          sim_number?: string | null
          status?: string
          sync_status?: string
          total_transactions?: number | null
        }
        Update: {
          android_version?: string | null
          app_version?: string | null
          assigned_officer_id?: string | null
          battery_level?: number | null
          cash_balance?: number | null
          created_at?: string
          current_lat?: number | null
          current_lng?: number | null
          device_type?: string
          id?: string
          imei?: string | null
          last_seen?: string | null
          lock_reason?: string | null
          locked?: boolean
          locked_at?: string | null
          manufacturer?: string | null
          model?: string | null
          network_strength?: string | null
          online_status?: string
          serial_number?: string
          sim_number?: string | null
          status?: string
          sync_status?: string
          total_transactions?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_devices_assigned_officer_id_fkey"
            columns: ["assigned_officer_id"]
            isOneToOne: false
            referencedRelation: "officers"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          division: string | null
          full_name: string | null
          id: string
          last_login: string | null
          phone: string | null
          status: string
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          division?: string | null
          full_name?: string | null
          id: string
          last_login?: string | null
          phone?: string | null
          status?: string
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          division?: string | null
          full_name?: string | null
          id?: string
          last_login?: string | null
          phone?: string | null
          status?: string
          username?: string | null
        }
        Relationships: []
      }
      system_control: {
        Row: {
          changed_at: string
          id: boolean
          locked: boolean
          revoked_before: string | null
          version: number
        }
        Insert: {
          changed_at?: string
          id?: boolean
          locked?: boolean
          revoked_before?: string | null
          version?: number
        }
        Update: {
          changed_at?: string
          id?: boolean
          locked?: boolean
          revoked_before?: string | null
          version?: number
        }
        Relationships: []
      }
      system_lock_accounts: {
        Row: {
          applied_banned_until: string | null
          created_at: string
          original_banned_until: string | null
          restored_at: string | null
          user_id: string
        }
        Insert: {
          applied_banned_until?: string | null
          created_at?: string
          original_banned_until?: string | null
          restored_at?: string | null
          user_id: string
        }
        Update: {
          applied_banned_until?: string | null
          created_at?: string
          original_banned_until?: string | null
          restored_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      approve_pairing_code_admin: {
        Args: {
          p_assigned_officer_id?: string
          p_caller: string
          p_code: string
          p_serial_number: string
        }
        Returns: string
      }
      check_pairing_status: {
        Args: { p_code: string }
        Returns: {
          approved_device_id: string
          expires_at: string
          serial_number: string
          status: string
        }[]
      }
      confirm_handover_admin: {
        Args: { p_handover_id: string; p_next_deadline?: string }
        Returns: undefined
      }
      get_paired_device: {
        Args: { p_device_id: string }
        Returns: {
          assigned_officer_id: string
          id: string
          locked: boolean
          serial_number: string
          status: string
        }[]
      }
      get_system_access: { Args: never; Returns: Json }
      lock_overdue_devices: { Args: never; Returns: number }
      mark_overdue_invoices: { Args: never; Returns: number }
      mobile_issue_invoice: {
        Args: {
          p_amount: number
          p_assessment_number?: string
          p_business_id: string
          p_discount?: number
          p_due_date?: string
          p_financial_year?: string
          p_notes?: string
          p_penalty?: number
          p_tax_type: string
        }
        Returns: {
          amount: number
          assessment_number: string | null
          business_id: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          discount: number
          due_date: string | null
          financial_year: string | null
          id: string
          invoice_number: string
          issue_date: string
          issued_by: string | null
          notes: string | null
          paid_amount: number
          penalty: number
          qr_code: string | null
          status: string
          tax_type: string
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mobile_record_payment: {
        Args: {
          p_amount: number
          p_business_id?: string
          p_device_id?: string
          p_gps_lat?: number
          p_gps_lng?: number
          p_invoice_id?: string
          p_paid_at?: string
          p_payment_method: string
          p_receipt_number?: string
          p_reference_number?: string
        }
        Returns: {
          amount: number
          business_id: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          device_id: string | null
          gps_lat: number | null
          gps_lng: number | null
          id: string
          invoice_id: string | null
          officer_id: string | null
          paid_at: string
          payment_method: string
          receipt_number: string
          reference_number: string | null
          status: string
          sync_status: string
        }
        SetofOptions: {
          from: "*"
          to: "payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mobile_submit_cash_handover: {
        Args: {
          p_actual_amount: number
          p_device_id: string
          p_signature_url?: string
        }
        Returns: {
          actual_amount: number
          collected_amount: number
          created_at: string
          device_id: string | null
          difference: number | null
          expected_amount: number
          handover_date: string
          id: string
          officer_id: string | null
          opening_balance: number
          signature_url: string | null
          status: string
          supervisor_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "cash_handovers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      recalc_invoice_totals: {
        Args: { p_invoice_id: string }
        Returns: undefined
      }
      record_payment_admin: {
        Args: {
          p_amount: number
          p_caller: string
          p_device_id?: string
          p_gps_lat?: number
          p_gps_lng?: number
          p_invoice_id: string
          p_officer_id?: string
          p_payment_method: string
          p_reference?: string
        }
        Returns: {
          new_paid: number
          new_status: string
          payment_id: string
          receipt_number: string
        }[]
      }
      set_officer_handover_deadline: {
        Args: { p_deadline: string; p_officer_id: string }
        Returns: undefined
      }
      set_system_lock: {
        Args: { p_expected_version: number; p_locked: boolean }
        Returns: Json
      }
      set_system_lock_service: {
        Args: {
          p_caller: string
          p_expected_version: number
          p_locked: boolean
        }
        Returns: undefined
      }
      system_access_allowed: { Args: never; Returns: boolean }
      unlock_device_admin: { Args: { p_device_id: string }; Returns: undefined }
    }
    Enums: {
      app_role:
        | "administrator"
        | "revenue_officer"
        | "supervisor"
        | "super_admin"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: [
        "administrator",
        "revenue_officer",
        "supervisor",
        "super_admin",
      ],
    },
  },
} as const
