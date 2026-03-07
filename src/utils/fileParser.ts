import Papa from 'papaparse';
import { XMLParser } from 'fast-xml-parser';

/**
 * Parse a CSV file text and extract address strings.
 * Handles single-column (address) and multi-column (street, city, state, zip) formats.
 */
export function parseCSV(text: string): string[] {
  const result = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  const addresses: string[] = [];

  for (const row of result.data) {
    const address = extractAddressFromRow(row);
    if (address) addresses.push(address);
  }

  // If header parsing found nothing, try no-header mode (one address per line)
  if (addresses.length === 0) {
    const noHeader = Papa.parse<string[]>(text.trim(), {
      header: false,
      skipEmptyLines: true,
    });
    for (const row of noHeader.data) {
      const joined = row.map((c) => c.trim()).filter(Boolean).join(', ');
      if (joined) addresses.push(joined);
    }
  }

  return addresses.filter(Boolean);
}

function extractAddressFromRow(row: Record<string, string>): string | null {
  const keys = Object.keys(row);

  // Single column containing full address
  const addressKey = keys.find((k) =>
    ['address', 'full_address', 'fulladdress', 'location', 'street_address'].includes(k)
  );
  if (addressKey && row[addressKey]?.trim()) {
    return row[addressKey].trim();
  }

  // Multi-column: build address from parts
  const street =
    row['street'] || row['address1'] || row['street_address'] || row['addr'] || '';
  const city = row['city'] || '';
  const state = row['state'] || row['st'] || '';
  const zip = row['zip'] || row['zipcode'] || row['postal_code'] || row['zip_code'] || '';

  if (street) {
    const parts = [street, city, state, zip].map((p) => p.trim()).filter(Boolean);
    return parts.join(', ');
  }

  // Fallback: concatenate all non-empty values
  const allValues = keys.map((k) => row[k]?.trim()).filter(Boolean);
  if (allValues.length > 0) return allValues.join(', ');

  return null;
}

/**
 * Parse an XML file text and extract address strings.
 * Supports common tag names: address, Address, location, street, delivery.
 */
export function parseXML(text: string): string[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: true,
    trimValues: true,
  });

  let parsed: unknown;
  try {
    parsed = parser.parse(text);
  } catch {
    throw new Error('Invalid XML file. Please check the file format and try again.');
  }

  const addresses: string[] = [];
  collectAddresses(parsed, addresses);
  return [...new Set(addresses.filter(Boolean))];
}

const ADDRESS_TAGS = new Set([
  'address', 'Address', 'ADDRESS',
  'location', 'Location', 'LOCATION',
  'street', 'Street', 'STREET',
  'delivery_address', 'deliveryAddress',
  'full_address', 'fullAddress',
]);

function collectAddresses(node: unknown, out: string[]): void {
  if (!node || typeof node !== 'object') return;

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (ADDRESS_TAGS.has(key)) {
      if (typeof value === 'string' && value.trim()) {
        out.push(value.trim());
      } else if (typeof value === 'object' && value !== null) {
        // Could be an array of address elements
        collectAddresses(value, out);
      }
    } else {
      collectAddresses(value, out);
    }
  }
}
