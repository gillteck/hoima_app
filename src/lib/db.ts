import { supabase } from "@/integrations/supabase/client";
export type Business = { id: string; business_name: string; owner_name: string | null; tin: string | null; phone: string | null; email: string | null; physical_address: string | null; division: string | null; category: string | null; gps_lat: number | null; gps_lng: number | null; status: string; date_registered: string };
export type Officer = { id: string; employee_id: string; full_name: string; phone: string | null; email: string | null; division: string | null; collection_area: string | null; status: string; monthly_target: number };
export type Device = { id: string; serial_number: string; imei: string | null; model: string | null; battery_level: number; network_strength: string; online_status: string; sync_status: string; assigned_officer_id: string | null; current_lat: number | null; current_lng: number | null; cash_balance: number; last_seen: string | null; status: string };
export type Invoice = { id: string; invoice_number: string; business_id: string | null; tax_type: string; amount: number; penalty: number; discount: number; paid_amount: number; status: string; issue_date: string; due_date: string | null; financial_year: string | null };
export type Payment = { id: string; receipt_number: string; invoice_id: string | null; business_id: string | null; officer_id: string | null; device_id: string | null; amount: number; payment_method: string; status: string; sync_status: string; paid_at: string };
export type Handover = { id: string; officer_id: string | null; device_id: string | null; opening_balance: number; collected_amount: number; expected_amount: number; actual_amount: number; difference: number; status: string; handover_date: string };
export type AuditLog = { id: string; user_name: string | null; role: string | null; action: string; table_name: string | null; record_id: string | null; ip_address: string | null; browser: string | null; created_at: string };

export const sb = supabase;
