import Anthropic from '@anthropic-ai/sdk';

type SupportedMimeType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/**
 * Use Claude's vision API to extract delivery addresses from an image.
 * Returns raw address strings (not yet geocoded).
 */
export async function extractAddressesFromImage(
  imageBase64: string,
  mimeType: SupportedMimeType,
  apiKey: string
): Promise<string[]> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: imageBase64 },
          },
          {
            type: 'text',
            text: `Extract all delivery addresses from this image.
Return ONLY the street addresses, one per line, formatted as "street address, city, state zip".
Do not include names, phone numbers, notes, codes, or any other text — just the addresses.
If the city/state/zip is missing from an address, infer it from nearby addresses in the image if possible.
If you cannot determine an address with confidence, skip it.`,
          },
        ],
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  return text
    .split('\n')
    .map((l) => l.replace(/^[-•*\d.)\s]+/, '').trim())
    .filter((l) => l.length > 5); // filter out empty/short lines
}

/**
 * Convert a File or Blob to base64 string and detect its MIME type.
 */
export async function fileToBase64(
  file: File
): Promise<{ base64: string; mimeType: SupportedMimeType }> {
  const supportedTypes: SupportedMimeType[] = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
  ];

  const mimeType = file.type as SupportedMimeType;
  if (!supportedTypes.includes(mimeType)) {
    throw new Error(`Unsupported image type: ${file.type}. Use JPEG, PNG, GIF, or WebP.`);
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // Remove data:image/...;base64, prefix
      const base64 = dataUrl.split(',')[1];
      resolve({ base64, mimeType });
    };
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}
