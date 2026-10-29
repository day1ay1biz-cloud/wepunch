import QRCode from "qrcode";

/**
 * The address printed on a business's counter sign. It uses the root domain
 * and the `/b/<slug>` path rather than a subdomain: printed signs live for
 * years, and this form keeps working with or without wildcard subdomains or
 * a custom domain later.
 */
export function joinUrl(slug: string, appUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000"): string {
  return `${appUrl.replace(/\/+$/, "")}/b/${slug}`;
}

// Quartile error correction survives scuffs and glare on a printed sign.
const QR_OPTIONS = { errorCorrectionLevel: "Q" as const, margin: 2 };

/** QR code as an SVG string: sharp at any print size. */
export function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { ...QR_OPTIONS, type: "svg", color: { dark: "#000000", light: "#ffffff" } });
}

/** QR code as a PNG, for tests and anyone who needs a raster file. */
export function qrPng(text: string, width = 600): Promise<Buffer> {
  return QRCode.toBuffer(text, { ...QR_OPTIONS, type: "png", width });
}
