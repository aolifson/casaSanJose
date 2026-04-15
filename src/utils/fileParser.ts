import Papa from 'papaparse';
import { XMLParser } from 'fast-xml-parser';
import type { ParsedDeliverySheet, PriorDeliveryAssignment } from '../types';

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

function normalizeCell(value: string | undefined): string {
  return value?.trim() ?? '';
}

function normalizeZip(value: string | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length === 5 ? digits : null;
}

function findCell(rows: string[][], target: string): { row: number; col: number } | null {
  const lowerTarget = target.toLowerCase();

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    for (let colIndex = 0; colIndex < row.length; colIndex++) {
      if (normalizeCell(row[colIndex]).toLowerCase() === lowerTarget) {
        return { row: rowIndex, col: colIndex };
      }
    }
  }

  return null;
}

export function parseDeliverySheetCsv(text: string): ParsedDeliverySheet {
  const result = Papa.parse<string[]>(text.trim(), {
    header: false,
    skipEmptyLines: false,
  });

  const rows = result.data.map((row) => row.map(normalizeCell));
  const thisWeekCell = findCell(rows, 'This week');
  const lastWeekCell = findCell(rows, 'Last Week');
  const driversCell = findCell(rows, 'Drivers');

  if (!thisWeekCell || !lastWeekCell || !driversCell) {
    throw new Error(
      'This CSV does not look like the Casa San Jose weekly sheet. Export the April or March tab as CSV and try again.'
    );
  }

  const deliveryZipCodes: string[] = [];
  const priorAssignments: PriorDeliveryAssignment[] = [];
  const driversByName = new Map<string, { name: string; neighborhood: string }>();

  const firstDataRow = Math.min(thisWeekCell.row, lastWeekCell.row, driversCell.row) + 1;

  for (let rowIndex = firstDataRow; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];

    const deliveryZip = normalizeZip(row[thisWeekCell.col]);
    if (deliveryZip) {
      deliveryZipCodes.push(deliveryZip);
    }

    const priorZip = normalizeZip(row[lastWeekCell.col]);
    const priorVolunteerName = normalizeCell(row[lastWeekCell.col + 1]);
    const priorNeighborhood = normalizeCell(row[lastWeekCell.col + 2]);
    if (priorZip && priorVolunteerName) {
      priorAssignments.push({
        zipCode: priorZip,
        volunteerName: priorVolunteerName,
        neighborhood: priorNeighborhood || undefined,
      });
    }

    const driverName = normalizeCell(row[driversCell.col]);
    const driverNeighborhood = normalizeCell(row[driversCell.col + 2]);
    if (driverName && driverNeighborhood) {
      driversByName.set(driverName, {
        name: driverName,
        neighborhood: driverNeighborhood,
      });
    }
  }

  if (deliveryZipCodes.length === 0) {
    throw new Error('No delivery ZIP codes were found in the "This week" column.');
  }

  if (driversByName.size === 0) {
    throw new Error('No drivers were found in the "Drivers" section.');
  }

  return {
    deliveryZipCodes,
    priorAssignments,
    drivers: [...driversByName.values()],
  };
}

export function parseZipCodeList(text: string): string[] {
  const matches = [...text.matchAll(/(\d{5})(?:\s*[xX*]\s*(\d+))?/g)];
  if (matches.length === 0) {
    throw new Error(
      'Could not find any ZIP codes. Paste a Casa San Jose weekly sheet export or a list like 15205, 15205x2, 15221 x3.'
    );
  }

  const zipCodes: string[] = [];

  for (const match of matches) {
    const zipCode = match[1];
    const count = Number.parseInt(match[2] ?? '1', 10);
    const safeCount = Number.isFinite(count) && count > 0 ? count : 1;

    for (let i = 0; i < safeCount; i++) {
      zipCodes.push(zipCode);
    }
  }

  return zipCodes;
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
