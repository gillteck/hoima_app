import jsPDF from "jspdf";
import { qrDataUrl, verifyUrl } from "@/lib/qr";
import { formatMoney, formatDateTime } from "@/lib/format";

// Central brand strings — change here to rebrand system-wide.
export const BRAND = {
  authority: "REPUBLIC OF UGANDA",
  council: "HOIMA CITY COUNCIL",
  system: "Revenue Management System",
  version: "v1.2.4",
  office: "Office of the Town Clerk · Directorate of Finance & Revenue",
  address: "P.O. Box 1, Hoima City · Main Street, Hoima",
  contact: "revenue@hoima.gov · +256 700 000 000 · www.hoima.gov",
  tin: "1000000000",
} as const;

// ---------- shared helpers ----------
function line(doc: jsPDF, x1: number, y: number, x2: number, weight = 0.2, color: [number, number, number] = [180, 180, 180]) {
  doc.setDrawColor(...color);
  doc.setLineWidth(weight);
  doc.line(x1, y, x2, y);
}

function drawHeader(doc: jsPDF, docLabel: string, docNumber: string) {
  // Top accent bar
  doc.setFillColor(15, 76, 58); // deep municipal green
  doc.rect(0, 0, 210, 6, "F");
  doc.setFillColor(212, 175, 55); // gold
  doc.rect(0, 6, 210, 1.2, "F");

  // Coat / seal placeholder circle
  doc.setDrawColor(15, 76, 58);
  doc.setLineWidth(0.8);
  doc.circle(24, 26, 10);
  doc.setFontSize(6);
  doc.setTextColor(15, 76, 58);
  doc.text("HCC", 24, 27, { align: "center" });
  doc.setFontSize(4.5);
  doc.text("SEAL", 24, 30, { align: "center" });

  // Authority / council block
  doc.setTextColor(20, 20, 20);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(BRAND.authority, 38, 18);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(15, 76, 58);
  doc.text(BRAND.council, 38, 25);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(90, 90, 90);
  doc.text(BRAND.office, 38, 30);
  doc.setFontSize(7.5);
  doc.text(BRAND.address, 38, 34);
  doc.text(BRAND.contact, 38, 38);

  // Document label block (right)
  doc.setDrawColor(220, 220, 220);
  doc.setFillColor(248, 249, 246);
  doc.setFillColor(248, 249, 246); doc.rect(140, 14, 55, 26, "FD");
  doc.setFontSize(7);
  doc.setTextColor(120, 120, 120);
  doc.setFont("helvetica", "bold");
  doc.text(docLabel.toUpperCase(), 167.5, 20, { align: "center" });
  doc.setTextColor(15, 76, 58);
  doc.setFontSize(11);
  doc.text(docNumber, 167.5, 27, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(120, 120, 120);
  doc.text(`Issued via ${BRAND.system}`, 167.5, 33, { align: "center" });
  doc.text(`Council TIN ${BRAND.tin}`, 167.5, 37, { align: "center" });

  line(doc, 15, 46, 195, 0.4, [15, 76, 58]);
}

function drawFooter(doc: jsPDF, pageNo: number, totalPages: number, refCode: string) {
  const y = 285;
  line(doc, 15, y - 4, 195);
  doc.setFontSize(7);
  doc.setTextColor(120, 120, 120);
  doc.setFont("helvetica", "normal");
  doc.text(`${BRAND.council} · ${BRAND.system} ${BRAND.version}`, 15, y);
  doc.text(`Ref: ${refCode}`, 105, y, { align: "center" });
  doc.text(`Page ${pageNo} of ${totalPages}`, 195, y, { align: "right" });
  doc.setFontSize(6.5);
  doc.setTextColor(150, 150, 150);
  doc.text(
    "Computer-generated document. Verify authenticity by scanning the QR code or visiting the system verification portal.",
    105,
    y + 4,
    { align: "center" },
  );
}

// ---------- INVOICE (58mm thermal, matches mobile POS layout) ----------
export async function generateInvoicePDF(inv: {
  invoice_number: string;
  tax_type: string;
  amount: number;
  penalty: number;
  discount: number;
  paid_amount: number;
  status: string;
  issue_date: string;
  due_date: string | null;
  financial_year: string | null;
  businesses?: {
    business_name?: string;
    owner_name?: string;
    tin?: string;
    phone?: string;
    email?: string;
    physical_address?: string;
  } | null;
  officers?: { full_name?: string; employee_id?: string } | null;
  pos_devices?: { serial_number?: string } | null;
}) {
  const W = 58;
  const doc = new jsPDF({ unit: "mm", format: [W, 220] });
  const cx = W / 2;
  const b = inv.businesses || {};
  const total = Number(inv.amount) + Number(inv.penalty) - Number(inv.discount);
  const balance = Math.max(total - Number(inv.paid_amount), 0);

  const dt = new Date(inv.issue_date);
  const dateStr = dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const timeStr = dt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  doc.setFont("courier", "normal");
  doc.setTextColor(0, 0, 0);

  const COLS = 32;
  let y = 6;

  const rule = (ch: string) => { doc.text(ch.repeat(COLS), cx, y, { align: "center" }); y += 3.5; };

  doc.setFontSize(7);
  rule("=");
  doc.setFont("courier", "bold");
  doc.setFontSize(10);
  doc.text("HOIMA CITY", cx, y, { align: "center" }); y += 4;
  doc.setFontSize(8);
  doc.text("Hotel & Lodge Tax Mgt System", cx, y, { align: "center" }); y += 4;
  doc.setFont("courier", "normal");
  doc.setFontSize(7);
  rule("=");
  y += 1;
  doc.setFont("courier", "bold");
  doc.setFontSize(11);
  doc.text("INVOICE", cx, y, { align: "center" }); y += 5;
  doc.setFont("courier", "normal");
  doc.setFontSize(8);

  const row = (label: string, value: string) => {
    doc.text(label, 2, y);
    doc.text(":", 20, y);
    doc.text(value, 22, y, { maxWidth: W - 24 });
    y += 3.8;
  };
  row("Invoice No", inv.invoice_number);
  row("Date", dateStr);
  row("Time", timeStr);
  row("Business", b.business_name || "—");
  row("Officer", inv.officers?.full_name || "—");
  row("POS Device", inv.pos_devices?.serial_number || "—");

  y += 1;
  rule("-");
  doc.setFont("courier", "bold");
  doc.setFontSize(9);
  doc.text("Amount Due", cx, y, { align: "center" }); y += 5;
  doc.setFontSize(13);
  doc.text(formatMoney(balance), cx, y, { align: "center" }); y += 4;
  doc.setFont("courier", "normal");
  doc.setFontSize(7);
  rule("-");
  y += 2;

  const qr = await qrDataUrl(verifyUrl("invoice", inv.invoice_number), 260);
  const qrSize = 26;
  doc.addImage(qr, "PNG", cx - qrSize / 2, y, qrSize, qrSize);
  y += qrSize + 3;
  doc.setFontSize(7);
  doc.text("Scan QR Code to View Invoice", cx, y, { align: "center" }); y += 5;

  doc.setFont("courier", "bold");
  doc.setFontSize(8);
  doc.text("RR & Family Transporters Ltd", cx, y, { align: "center" }); y += 4;
  doc.setFont("courier", "normal");
  doc.setFontSize(7);
  const note1 = "This invoice is not proof of payment.";
  const note2 = "Payment will be confirmed upon issuance";
  const note3 = "of an official receipt.";
  doc.text(note1, cx, y, { align: "center" }); y += 3.2;
  doc.text(note2, cx, y, { align: "center" }); y += 3.2;
  doc.text(note3, cx, y, { align: "center" }); y += 3.2;
  rule("=");

  doc.save(`${inv.invoice_number}.pdf`);
}

// ---------- RECEIPT (80mm thermal, mobile POS style) ----------
export async function generateReceiptPDF(p: {
  receipt_number: string;
  paid_at: string;
  amount: number;
  payment_method: string;
  reference_number?: string | null;
  businesses?: { business_name?: string; tin?: string; owner_name?: string; physical_address?: string } | null;
  invoices?: { invoice_number?: string; tax_type?: string; financial_year?: string | null; amount?: number; penalty?: number; discount?: number; paid_amount?: number; status?: string } | null;
  officers?: { full_name?: string; employee_id?: string } | null;
  pos_devices?: { serial_number?: string } | null;
}) {
  // 80mm thermal receipt format (matches mobile POS printer output)
  const W = 80;
  const doc = new jsPDF({ unit: "mm", format: [W, 200] });
  const cx = W / 2;
  const b = p.businesses || {};
  const inv = p.invoices || {};

  const methodLabel = (m: string) =>
    ({ mobile_money: "Mobile Money", cash: "Cash", bank: "Bank", card: "Card", pos: "POS" } as Record<string, string>)[m] ||
    m.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const dt = new Date(p.paid_at);
  const dateStr =
    dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) +
    " " +
    dt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  doc.setFont("courier", "normal");
  doc.setTextColor(0, 0, 0);

  // ==== divider line ====
  let y = 8;
  doc.setFontSize(8);
  doc.text("=".repeat(32), cx, y, { align: "center" });
  y += 5;

  // Title
  doc.setFont("courier", "bold");
  doc.setFontSize(11);
  doc.text("HOIMA CITY", cx, y, { align: "center" });
  y += 5;
  doc.setFontSize(9);
  doc.text(`${inv.tax_type || "Revenue"} Tax`, cx, y, { align: "center" });
  y += 5;
  doc.setFontSize(11);
  doc.text("INVOICE", cx, y, { align: "center" });
  y += 4;
  doc.setFont("courier", "normal");
  doc.setFontSize(8);
  doc.text("=".repeat(32), cx, y, { align: "center" });
  y += 6;

  // Key/value rows
  const row = (label: string, value: string) => {
    doc.text(label.padEnd(10, " "), 4, y);
    doc.text(":", 26, y);
    doc.text(value, 29, y, { maxWidth: W - 32 });
    y += 4.5;
  };
  doc.setFontSize(8.5);
  row("Receipt No", p.receipt_number);
  row("Invoice No", inv.invoice_number || "—");
  row("Date", dateStr);
  row("Hotel", b.business_name || "—");
  row("TIN", b.tin || "—");
  row("Revenue", inv.tax_type || "General");
  row("Officer", p.officers?.full_name || "—");
  row("Method", methodLabel(p.payment_method));


  y += 1;
  doc.text("-".repeat(32), cx, y, { align: "center" });
  y += 5;

  // Total paid this receipt
  doc.setFont("courier", "bold");
  doc.setFontSize(10);
  doc.text("AMOUNT PAID", cx, y, { align: "center" });
  y += 6;
  doc.setFontSize(14);
  doc.text(formatMoney(p.amount), cx, y, { align: "center" });
  y += 5;
  doc.setFont("courier", "normal");
  doc.setFontSize(8);
  doc.text("-".repeat(32), cx, y, { align: "center" });
  y += 5;

  // Invoice ledger summary (auto-paired to pending invoice)
  if (inv && (inv.amount != null || inv.invoice_number)) {
    const invTotal = Number(inv.amount || 0) + Number(inv.penalty || 0) - Number(inv.discount || 0);
    const paidToDate = Number(inv.paid_amount || 0); // already includes this payment via trigger
    const balance = Math.max(invTotal - paidToDate, 0);
    doc.setFont("courier", "bold");
    doc.setFontSize(8.5);
    doc.text("INVOICE LEDGER", cx, y, { align: "center" });
    y += 4;
    doc.setFont("courier", "normal");
    const kv = (k: string, v: string) => {
      doc.text(k, 4, y);
      doc.text(v, W - 4, y, { align: "right" });
      y += 4;
    };
    kv("Invoice Total", formatMoney(invTotal));
    kv("Paid to Date", formatMoney(paidToDate));
    doc.setFont("courier", "bold");
    kv(balance <= 0 ? "FULLY SETTLED" : "Balance Due", formatMoney(balance));
    doc.setFont("courier", "normal");
    y += 1;
    doc.text("-".repeat(32), cx, y, { align: "center" });
    y += 5;
  }

  // QR
  const qr = await qrDataUrl(verifyUrl("receipt", p.receipt_number), 260);
  const qrSize = 32;
  doc.addImage(qr, "PNG", cx - qrSize / 2, y, qrSize, qrSize);
  y += qrSize + 4;
  doc.setFontSize(8);
  doc.text("Scan to Verify", cx, y, { align: "center" });
  y += 6;

  // Thank you
  doc.setFont("courier", "bold");
  doc.text("Thank you for your payment.", cx, y, { align: "center" });
  y += 4;
  doc.setFont("courier", "normal");
  doc.text("Please keep this receipt.", cx, y, { align: "center" });
  y += 5;
  doc.text("=".repeat(32), cx, y, { align: "center" });

  doc.save(`${p.receipt_number}.pdf`);
}

