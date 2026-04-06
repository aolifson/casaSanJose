import type { WorkBook } from 'xlsx';

export interface GoogleSheetWorkbook {
  spreadsheetId: string;
  spreadsheetUrl: string;
  workbook: WorkBook;
  workbookName?: string;
  tabs: string[];
}

export function extractSpreadsheetId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const directMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (directMatch) return directMatch[1];

  const bareMatch = trimmed.match(/^[a-zA-Z0-9-_]{20,}$/);
  return bareMatch ? bareMatch[0] : null;
}

export function buildSpreadsheetUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

export async function loadGoogleSheetWorkbook(input: string): Promise<GoogleSheetWorkbook> {
  const XLSX = await import('xlsx');
  const spreadsheetId = extractSpreadsheetId(input);
  if (!spreadsheetId) {
    throw new Error('Enter a valid Google Sheet URL or spreadsheet ID.');
  }

  const exportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`;
  const response = await fetch(exportUrl);
  if (!response.ok) {
    throw new Error('Could not load that Google Sheet. Make sure the sheet is shared so this app can access it.');
  }

  const arrayBuffer = await response.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });

  return {
    spreadsheetId,
    spreadsheetUrl: buildSpreadsheetUrl(spreadsheetId),
    workbook,
    workbookName: workbook.Props?.Title,
    tabs: [...workbook.SheetNames],
  };
}

export async function workbookSheetToCsv(workbook: WorkBook, tabName: string): Promise<string> {
  const XLSX = await import('xlsx');
  const worksheet = workbook.Sheets[tabName];
  if (!worksheet) {
    throw new Error(`Could not find the tab "${tabName}" in that workbook.`);
  }

  return XLSX.utils.sheet_to_csv(worksheet, { blankrows: true });
}
