# Bank Transfer Implementation Guide

## Overview

This module provides a comprehensive bank transfer payment system for the mobile revenue collection app. It allows revenue officers to submit bank transfer payments, which admins can then verify and confirm.

## Database Schema

### `bank_transfers` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `payment_id` | UUID (FK) | Reference to payments table |
| `invoice_id` | UUID (FK) | Optional invoice reference |
| `business_id` | UUID (FK) | Optional business reference |
| `account_name` | TEXT | Name on bank account |
| `account_number` | TEXT | Bank account number |
| `bank_name` | TEXT | Name of the bank |
| `bank_code` | TEXT | SWIFT/Bank code |
| `transaction_reference` | TEXT | Bank transaction reference |
| `amount` | NUMERIC | Transfer amount |
| `status` | TEXT | `pending`, `confirmed`, or `rejected` |
| `proof_document_url` | TEXT | URL to proof of payment document |
| `notes` | TEXT | Admin notes |
| `submitted_at` | TIMESTAMPTZ | Submission timestamp |
| `confirmed_at` | TIMESTAMPTZ | Confirmation timestamp (null if pending) |
| `created_at` | TIMESTAMPTZ | Record creation time |
| `updated_at` | TIMESTAMPTZ | Last update time |

## Server Functions

### 1. `submitBankTransfer()`

Submit a new bank transfer payment.

**Input:**
```typescript
{
  invoice_id?: string;        // Optional UUID of related invoice
  business_id?: string;       // Optional UUID of business
  account_name: string;       // Required: Name on account
  account_number: string;     // Required: Account number
  bank_name: string;          // Required: Bank name
  bank_code?: string;         // Optional: Bank code/SWIFT
  transaction_reference?: string;  // Optional: Bank reference
  amount: number;             // Required: Amount in numbers
  proof_document_url?: string; // Optional: URL to proof document
  notes?: string;             // Optional: Notes
}
```

**Response:**
```typescript
{
  success: true,
  transfer_id: string;        // UUID of bank_transfers record
  payment_id: string;         // UUID of payments record
  receipt_number: string;     // Auto-generated receipt number (RC-YYYY-######)
}
```

**Usage Example (Mobile App):**
```typescript
import { submitBankTransfer } from "@/lib/bank-transfers.functions";

const result = await submitBankTransfer({
  data: {
    invoice_id: "550e8400-e29b-41d4-a716-446655440000",
    account_name: "Hoima City Council",
    account_number: "01010101010101",
    bank_name: "Stanbic Bank Uganda",
    bank_code: "SBICUGKX",
    amount: 5000000,
    proof_document_url: "https://example.com/proof-2024-07-14.pdf"
  }
});

// result: { success: true, transfer_id: "...", payment_id: "...", receipt_number: "RC-2026-000001" }
```

---

### 2. `confirmBankTransfer()`

Confirm a pending bank transfer (admin only).

**Input:**
```typescript
{
  transfer_id: string;        // UUID of bank_transfers record
  transaction_reference?: string;  // Bank's transaction reference
  proof_document_url?: string; // Updated proof URL
  notes?: string;             // Admin notes
}
```

**Response:**
```typescript
{
  success: true,
  receipt_number: string;     // Associated receipt number
}
```

---

### 3. `rejectBankTransfer()`

Reject a bank transfer and remove the associated payment (admin only).

**Input:**
```typescript
{
  transfer_id: string;        // UUID of bank_transfers record
  status: "rejected";         // Must be "rejected"
  notes?: string;             // Rejection reason
}
```

**Response:**
```typescript
{
  success: true
}
```

---

### 4. `getBankTransfer()`

Get all bank transfers for the current user.

**Response:**
```typescript
Array<BankTransferWithPayment>
```

---

### 5. `getPendingBankTransfers()`

Get all pending bank transfers (admin only).

**Response:**
```typescript
Array<BankTransferWithPayment>
```

## Supported Banks

The module includes a predefined list of Ugandan banks with their SWIFT codes:

```typescript
- Bank of Uganda (BOU)
- Stanbic Bank Uganda (SBICUGKX)
- Barclays Bank Uganda (BARXUGKX)
- Uganda Commercial Bank (UCBAUGKX)
- DFCU Bank (DFCBUGKX)
- Centenary Bank (CENTUGKA)
- African Development Bank (AFBKUGKA)
- Housing Finance Bank (HFBKUGKA)
- Equity Bank Uganda (EQBLUGKA)
- KCB Bank Uganda (KCBLUGKA)
- Crane Bank (CRBLUGKA)
- Ecobank Uganda (ECOBUGKA)
```

You can use the helper function:
```typescript
import { getBankCode } from "@/lib/bank-transfers.types";

const code = getBankCode("Stanbic Bank Uganda"); // Returns "SBICUGKX"
```

## Validation Helpers

```typescript
import {
  isValidAccountNumber,
  formatBankAccount,
  formatMoney
} from "@/lib/bank-transfers.types";

// Validate account number (10-16 digits)
const isValid = isValidAccountNumber("01010101010101"); // true

// Format for display (masks account number)
const display = formatBankAccount("01010101010101", "Stanbic Bank"); 
// Returns: "Stanbic Bank (*010101)"
```

## Mobile App Integration Steps

### 1. Create Bank Transfer UI Form

```typescript
import { submitBankTransfer } from "@/lib/bank-transfers.functions";
import { SUPPORTED_BANKS, isValidAccountNumber } from "@/lib/bank-transfers.types";

export function BankTransferForm({ invoiceId }: { invoiceId: string }) {
  const [formData, setFormData] = useState({
    invoice_id: invoiceId,
    account_name: "",
    account_number: "",
    bank_name: "",
    bank_code: "",
    amount: 0,
    transaction_reference: "",
    notes: "",
  });

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!isValidAccountNumber(formData.account_number)) {
      alert("Invalid account number format");
      return;
    }

    setLoading(true);
    try {
      const response = await submitBankTransfer({
        data: formData,
      });
      setResult(response);
      // Show success message with receipt number
      alert(`Bank transfer submitted! Receipt: ${response.receipt_number}`);
    } catch (error) {
      alert(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label>Invoice</label>
        <input type="text" value={invoiceId} disabled className="w-full border p-2 rounded" />
      </div>

      <div>
        <label>Bank Name *</label>
        <select
          value={formData.bank_name}
          onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
          className="w-full border p-2 rounded"
          required
        >
          <option value="">Select a bank</option>
          {SUPPORTED_BANKS.map((bank) => (
            <option key={bank.code} value={bank.name}>
              {bank.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label>Account Name *</label>
        <input
          type="text"
          value={formData.account_name}
          onChange={(e) => setFormData({ ...formData, account_name: e.target.value })}
          className="w-full border p-2 rounded"
          placeholder="Name on account"
          required
        />
      </div>

      <div>
        <label>Account Number *</label>
        <input
          type="text"
          value={formData.account_number}
          onChange={(e) => setFormData({ ...formData, account_number: e.target.value })}
          className="w-full border p-2 rounded"
          placeholder="14-digit account number"
          required
        />
      </div>

      <div>
        <label>Amount *</label>
        <input
          type="number"
          value={formData.amount}
          onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) })}
          className="w-full border p-2 rounded"
          required
        />
      </div>

      <div>
        <label>Transaction Reference</label>
        <input
          type="text"
          value={formData.transaction_reference}
          onChange={(e) => setFormData({ ...formData, transaction_reference: e.target.value })}
          className="w-full border p-2 rounded"
          placeholder="Bank reference number"
        />
      </div>

      <div>
        <label>Notes</label>
        <textarea
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          className="w-full border p-2 rounded"
          placeholder="Optional notes"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-brand text-white p-2 rounded font-medium disabled:opacity-50"
      >
        {loading ? "Submitting..." : "Submit Bank Transfer"}
      </button>

      {result && (
        <div className="p-4 bg-green-50 border border-green-200 rounded">
          <p className="font-semibold">Receipt: {result.receipt_number}</p>
          <p className="text-sm text-green-700">Bank transfer submitted successfully!</p>
        </div>
      )}
    </form>
  );
}
```

### 2. Admin Dashboard for Pending Transfers

```typescript
import { getPendingBankTransfers, confirmBankTransfer } from "@/lib/bank-transfers.functions";
import { useState, useEffect } from "react";

export function PendingBankTransfers() {
  const [transfers, setTransfers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadTransfers = async () => {
      try {
        const data = await getPendingBankTransfers();
        setTransfers(data);
      } catch (error) {
        console.error("Failed to load transfers:", error);
      } finally {
        setLoading(false);
      }
    };
    loadTransfers();
  }, []);

  const handleConfirm = async (transferId: string) => {
    try {
      await confirmBankTransfer({
        data: { transfer_id: transferId },
      });
      // Refresh list
      setTransfers(transfers.filter((t) => t.id !== transferId));
      alert("Bank transfer confirmed!");
    } catch (error) {
      alert(`Error: ${error.message}`);
    }
  };

  if (loading) return <div>Loading pending transfers...</div>;

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Pending Bank Transfers</h2>
      {transfers.length === 0 ? (
        <p className="text-gray-500">No pending transfers</p>
      ) : (
        <div className="space-y-2">
          {transfers.map((transfer) => (
            <div key={transfer.id} className="border rounded p-4 space-y-2">
              <p className="font-semibold">{transfer.account_name}</p>
              <p className="text-sm text-gray-600">
                {transfer.bank_name} • {transfer.account_number.slice(-4)}
              </p>
              <p className="font-bold">Amount: {transfer.amount.toLocaleString("en-UG", { currency: "UGX", style: "currency" })}</p>
              <button
                onClick={() => handleConfirm(transfer.id)}
                className="bg-green-600 text-white px-4 py-2 rounded"
              >
                Confirm Transfer
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

## Payment Status Flow

```
User submits bank transfer
  ↓
submitBankTransfer()
  ├─ Creates payment record (status: pending, method: "bank")
  └─ Creates bank_transfer record (status: pending)
  ↓
Admin verifies payment received
  ↓
confirmBankTransfer()
  ├─ Updates bank_transfer (status: confirmed)
  └─ Updates payment (status: success)
  ↓
Payment appears in receipts/dashboard
```

## Security Notes

- ✅ Admin verification required for confirmations and rejections
- ✅ Staff (officers, supervisors) can only submit transfers, cannot approve
- ✅ Account numbers are masked in display (`*010101` instead of full number)
- ✅ Row-level security policies enforce access control
- ✅ All operations are logged in the audit trail

## Files Modified/Created

- `supabase/migrations/20260714120000_add_bank_transfers_table.sql` - Database schema
- `src/lib/bank-transfers.functions.ts` - Server functions
- `src/lib/bank-transfers.types.ts` - TypeScript types and helpers

## Next Steps

1. Run database migrations: `npm run migrate`
2. Integrate the forms into your mobile app
3. Add bank transfer UI to the payment method selector
4. Create admin dashboard to review pending transfers
5. Add document upload for proof of payment
