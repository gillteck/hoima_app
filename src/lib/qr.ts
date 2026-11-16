import QRCode from "qrcode";

export async function qrDataUrl(value: string, size = 160): Promise<string> {
  return QRCode.toDataURL(value, { width: size, margin: 1, errorCorrectionLevel: "M" });
}

export function verifyUrl(kind: "receipt" | "invoice", number: string): string {
  const base = typeof window !== "undefined" ? window.location.origin : "";
  return `${base}/verify/${kind}/${encodeURIComponent(number)}`;
}
