import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import fs from "fs";

const p = {
  receipt_number: "RCP-2026-000123",
  paid_at: new Date().toISOString(),
  businesses: { business_name: "Kampala Traders Ltd", tin: "1000234567" },
  invoices: { invoice_number: "INV-2026-000456" },
  officers: { full_name: "Jane Nakato" },
  payment_method: "mobile_money",
  amount: 250000,
};

const fmtMoney = n => "UGX " + Number(n).toLocaleString("en-US");
const fmtDT = d => new Date(d).toLocaleString("en-US", { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit"});

const doc = new jsPDF({ unit:"mm", format:[80,220] });
doc.setFontSize(12); doc.text("CIVIC REVENUE", 40, 10, {align:"center"});
doc.setFontSize(8); doc.text("Municipal Receipt", 40, 15, {align:"center"});
doc.line(5,18,75,18);
doc.text(`Receipt: ${p.receipt_number}`,5,24);
doc.text(`Date: ${fmtDT(p.paid_at)}`,5,30);
doc.text(`Business: ${p.businesses.business_name}`,5,36);
doc.text(`TIN: ${p.businesses.tin}`,5,42);
doc.text(`Invoice: ${p.invoices.invoice_number}`,5,48);
doc.text(`Officer: ${p.officers.full_name}`,5,54);
doc.text(`Method: ${p.payment_method}`,5,60);
doc.line(5,63,75,63);
doc.setFontSize(14); doc.text(fmtMoney(p.amount),40,72,{align:"center"});
const qr = await QRCode.toDataURL(`https://muniverse-collect.lovable.app/verify/receipt/${p.receipt_number}`, {width:200, margin:1});
doc.addImage(qr,"PNG",25,80,30,30);
doc.setFontSize(7); doc.text("Scan to verify",40,114,{align:"center"});
doc.setFontSize(8); doc.text("Thank you for your contribution",40,122,{align:"center"});
doc.text("to municipal development.",40,127,{align:"center"});
fs.writeFileSync("/tmp/browser/receipt/receipt.pdf", Buffer.from(doc.output("arraybuffer")));
console.log("ok");
