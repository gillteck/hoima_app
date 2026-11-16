/**
 * Bank Transfer Types
 * Extends Supabase auto-generated types for bank transfer functionality
 */

export type BankTransferStatus = "pending" | "confirmed" | "rejected";

export interface BankTransfer {
  id: string;
  payment_id: string | null;
  invoice_id: string | null;
  business_id: string | null;
  account_name: string;
  account_number: string;
  bank_name: string;
  bank_code: string | null;
  transaction_reference: string | null;
  amount: number;
  status: BankTransferStatus;
  proof_document_url: string | null;
  notes: string | null;
  submitted_at: string;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BankTransferWithPayment extends BankTransfer {
  payment?: {
    receipt_number: string;
    amount: number;
    status: string;
  } | null;
  invoice?: {
    invoice_number: string;
  } | null;
  business?: {
    business_name: string;
  } | null;
}

export interface BankTransferSubmissionPayload {
  invoice_id?: string | null;
  business_id?: string | null;
  account_name: string;
  account_number: string;
  bank_name: string;
  bank_code?: string | null;
  transaction_reference?: string | null;
  amount: number;
  proof_document_url?: string | null;
  notes?: string | null;
}

export interface BankTransferResponse {
  success: boolean;
  transfer_id: string;
  payment_id: string;
  receipt_number: string;
}

/**
 * Bank details for predefined banks (reference data)
 */
export const SUPPORTED_BANKS = [
  { name: "Bank of Uganda", code: "BOU" },
  { name: "Stanbic Bank Uganda", code: "SBICUGKX" },
  { name: "Barclays Bank Uganda", code: "BARXUGKX" },
  { name: "Uganda Commercial Bank", code: "UCBAUGKX" },
  { name: "DFCU Bank", code: "DFCBUGKX" },
  { name: "Centenary Bank", code: "CENTUGKA" },
  { name: "African Development Bank", code: "AFBKUGKA" },
  { name: "Housing Finance Bank", code: "HFBKUGKA" },
  { name: "Equity Bank Uganda", code: "EQBLUGKA" },
  { name: "KCB Bank Uganda", code: "KCBLUGKA" },
  { name: "Crane Bank", code: "CRBLUGKA" },
  { name: "Ecobank Uganda", code: "ECOBUGKA" },
] as const;

/**
 * Get bank code by name
 */
export const getBankCode = (bankName: string): string | null => {
  const bank = SUPPORTED_BANKS.find((b) => b.name.toLowerCase() === bankName.toLowerCase());
  return bank?.code || null;
};

/**
 * Format bank account display
 */
export const formatBankAccount = (accountNumber: string, bankName: string): string => {
  const masked = "*".repeat(Math.max(0, accountNumber.length - 4)) + accountNumber.slice(-4);
  return `${bankName} (${masked})`;
};

/**
 * Validate bank account number format
 * Most Ugandan bank accounts are 14 digits
 */
export const isValidAccountNumber = (accountNumber: string): boolean => {
  const cleaned = accountNumber.replace(/\D/g, "");
  return cleaned.length >= 10 && cleaned.length <= 16;
};
