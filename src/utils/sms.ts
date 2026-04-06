export interface SmsResult {
  success: boolean;
  error?: string;
  quotaRemaining?: number;
}

/**
 * Send an SMS via TextBelt (https://textbelt.com).
 * Use key "textbelt" for 1 free text/day, or a purchased key for paid texts.
 */
export async function sendTextBelt(
  phone: string,
  message: string,
  apiKey: string,
): Promise<SmsResult> {
  const digits = phone.replace(/\D/g, '');
  const resp = await fetch('https://textbelt.com/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: digits, message, key: apiKey }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json() as { success: boolean; error?: string; quotaRemaining?: number };
  return data;
}
