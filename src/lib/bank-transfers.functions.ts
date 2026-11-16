import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSystemAccess } from "./system-access-middleware";
import { assertIsAdmin, assertIsSuperAdmin } from "@/lib/admin-auth";

const SubmitBankTransferSchema = z.object({
  invoice_id: z.string().uuid().optional().nullable(),
  business_id: z.string().uuid().optional().nullable(),
  account_name: z.string().min(1, "Account name is required"),
  account_number: z.string().min(1, "Account number is required"),
  bank_name: z.string().min(1, "Bank name is required"),
  bank_code: z.string().optional().nullable(),
  transaction_reference: z.string().optional().nullable(),
  amount: z.number().positive("Amount must be positive"),
  proof_document_url: z.string().url().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type BankTransferSubmission = z.infer<typeof SubmitBankTransferSchema>;

const ConfirmBankTransferSchema = z.object({
  transfer_id: z.string().uuid(),
  transaction_reference: z.string().optional().nullable(),
  proof_document_url: z.string().url().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const UpdateBankTransferStatusSchema = z.object({
  transfer_id: z.string().uuid(),
  status: z.enum(["pending", "confirmed", "rejected"]),
  notes: z.string().optional().nullable(),
});

/**
 * Submit a bank transfer payment
 * Stores the bank transfer details and creates a pending payment record
 */
export const submitBankTransfer = createServerFn({ method: "POST" })
  .middleware([requireSystemAccess])
  .inputValidator((data: unknown) => SubmitBankTransferSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    
    // Verify user is staff (officer, supervisor, or admin)
    const { data: userRole, error: roleError } = await db
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .in("role", ["administrator", "supervisor", "revenue_officer"])
      .maybeSingle();
    
    if (roleError) throw new Error(roleError.message);
    if (!userRole) throw new Error("Only staff members can submit bank transfers");

    // Create payment record — mark as success immediately so it appears in
    // Transactions right away. Reference number + bank name are the audit trail.
    const nowIso = new Date().toISOString();
    const { data: paymentData, error: paymentError } = await db
      .from("payments")
      .insert({
        invoice_id: data.invoice_id || null,
        business_id: data.business_id || null,
        amount: data.amount,
        payment_method: "bank_transfer",
        reference_number: data.transaction_reference || null,
        status: "success",
        sync_status: "synced",
        paid_at: nowIso,
      })
      .select("id, receipt_number")
      .single();

    if (paymentError) throw new Error(`Failed to create payment: ${paymentError.message}`);

    // Create bank transfer record — auto-confirmed
    const { data: transferData, error: transferError } = await db
      .from("bank_transfers")
      .insert({
        payment_id: paymentData.id,
        invoice_id: data.invoice_id || null,
        business_id: data.business_id || null,
        account_name: data.account_name,
        account_number: data.account_number,
        bank_name: data.bank_name,
        bank_code: data.bank_code || null,
        transaction_reference: data.transaction_reference || null,
        amount: data.amount,
        proof_document_url: data.proof_document_url || null,
        notes: data.notes || null,
        status: "confirmed",
        confirmed_at: nowIso,
      })
      .select("id")
      .single();

    if (transferError) throw new Error(`Failed to create bank transfer: ${transferError.message}`);

    return {
      success: true as const,
      transfer_id: transferData.id,
      payment_id: paymentData.id,
      receipt_number: paymentData.receipt_number,
    };
  });

/**
 * Confirm a bank transfer (admin only)
 * Marks the transfer as confirmed and updates payment status
 */
export const confirmBankTransfer = createServerFn({ method: "POST" })
  .middleware([requireSystemAccess])
  .inputValidator((data: unknown) => ConfirmBankTransferSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    // Verify admin
    await assertIsAdmin(supabaseAdmin, context.userId);

    // Get the bank transfer to find associated payment
    const { data: transfer, error: transferGetError } = await db.from("bank_transfers")
      .select("payment_id, amount")
      .eq("id", data.transfer_id)
      .single();

    if (transferGetError) throw new Error(`Failed to fetch transfer: ${transferGetError.message}`);
    if (!transfer) throw new Error("Bank transfer not found");

    // Update bank transfer status
    const { error: updateTransferError } = await db.from("bank_transfers")
      .update({
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
        transaction_reference: data.transaction_reference || undefined,
        proof_document_url: data.proof_document_url || undefined,
        notes: data.notes || undefined,
      })
      .eq("id", data.transfer_id);

    if (updateTransferError) throw new Error(`Failed to confirm transfer: ${updateTransferError.message}`);

    // Update associated payment to success
    const { data: updatedPayment, error: updatePaymentError } = await db.from("payments")
      .update({ status: "success" })
      .eq("id", transfer.payment_id)
      .select("receipt_number")
      .single();

    if (updatePaymentError) throw new Error(`Failed to update payment: ${updatePaymentError.message}`);

    return {
      success: true as const,
      receipt_number: updatedPayment.receipt_number,
    };
  });

/**
 * Reject a bank transfer (admin only)
 * Marks the transfer as rejected and updates payment status
 */
export const rejectBankTransfer = createServerFn({ method: "POST" })
  .middleware([requireSystemAccess])
  .inputValidator((data: unknown) => UpdateBankTransferStatusSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    // Verify admin
    await assertIsAdmin(supabaseAdmin, context.userId);

    // Get the bank transfer
    const { data: transfer, error: transferGetError } = await db.from("bank_transfers")
      .select("payment_id")
      .eq("id", data.transfer_id)
      .single();

    if (transferGetError) throw new Error(`Failed to fetch transfer: ${transferGetError.message}`);
    if (!transfer) throw new Error("Bank transfer not found");

    // Update bank transfer to rejected
    const { error: updateTransferError } = await db.from("bank_transfers")
      .update({
        status: "rejected",
        notes: data.notes || undefined,
      })
      .eq("id", data.transfer_id);

    if (updateTransferError) throw new Error(`Failed to reject transfer: ${updateTransferError.message}`);

    // Delete the associated payment (since transfer was rejected)
    const { error: deletePaymentError } = await db.from("payments")
      .delete()
      .eq("id", transfer.payment_id);

    if (deletePaymentError) throw new Error(`Failed to remove payment: ${deletePaymentError.message}`);

    return {
      success: true as const,
    };
  });

/**
 * Get bank transfer details
 */
export const getBankTransfer = createServerFn({ method: "GET" })
  .middleware([requireSystemAccess])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    const { data: transfers, error } = await db
      .from("bank_transfers")
      .select(`
        *,
        payment:payment_id(receipt_number, amount, status)
      `)
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Failed to fetch transfers: ${error.message}`);
    return transfers;
  });

/**
 * Get pending bank transfers (admin only)
 */
export const getPendingBankTransfers = createServerFn({ method: "GET" })
  .middleware([requireSystemAccess])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    // Verify admin
    await assertIsAdmin(supabaseAdmin, context.userId);

    const { data: transfers, error } = await db.from("bank_transfers")
      .select(`
        *,
        payment:payment_id(receipt_number, amount, status),
        invoice:invoice_id(invoice_number),
        business:business_id(business_name)
      `)
      .eq("status", "pending")
      .order("submitted_at", { ascending: true });

    if (error) throw new Error(`Failed to fetch pending transfers: ${error.message}`);
    return transfers;
  });
