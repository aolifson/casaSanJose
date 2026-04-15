import type {
  DeliverySheetDriver,
  GeocodedAddress,
  PriorDeliveryAssignment,
  VolunteerRouteResult,
  WeeklySheetContext,
} from '../types';

type CellValue = string | number | boolean;

interface ExportRow {
  thisWeekDriver: string;
  driverNeighborhood: string;
  deliveryZip: string;
  fullAddress: string;
  routeOrder: number;
  lastWeekDriver: string;
  lastWeekNeighborhood: string;
  newClient: string;
  comments: string;
  routeLink: string;
}

const HEADER_STYLE = {
  font: { bold: true, color: { rgb: '1F2937' } },
  fill: { patternType: 'solid', fgColor: { rgb: 'E5E7EB' } },
  alignment: { vertical: 'center', horizontal: 'center' },
  border: {
    top: { style: 'thin', color: { rgb: 'D1D5DB' } },
    bottom: { style: 'thin', color: { rgb: 'D1D5DB' } },
    left: { style: 'thin', color: { rgb: 'D1D5DB' } },
    right: { style: 'thin', color: { rgb: 'D1D5DB' } },
  },
};

const HIGHLIGHT_STYLE = {
  fill: { patternType: 'solid', fgColor: { rgb: 'FFF200' } },
};

function zipFromAddress(address: GeocodedAddress): string {
  return address.postalCode?.replace(/\D/g, '').slice(0, 5)
    || address.raw.replace(/\D/g, '').slice(0, 5)
    || address.formatted.replace(/\D/g, '').slice(0, 5);
}

function buildPriorQueues(priorAssignments: PriorDeliveryAssignment[]): Map<string, PriorDeliveryAssignment[]> {
  const queues = new Map<string, PriorDeliveryAssignment[]>();

  for (const assignment of priorAssignments) {
    const existing = queues.get(assignment.zipCode) ?? [];
    existing.push(assignment);
    queues.set(assignment.zipCode, existing);
  }

  return queues;
}

function buildDriverNeighborhoodLookup(drivers: DeliverySheetDriver[]): Map<string, string> {
  return new Map(drivers.map((driver) => [driver.name, driver.neighborhood]));
}

function displayVolunteerName(name: string | undefined, index: number): string {
  return name?.trim() || `Volunteer ${index + 1}`;
}

function buildExportRows(
  results: VolunteerRouteResult[],
  weeklySheet?: WeeklySheetContext
): ExportRow[] {
  const priorQueues = buildPriorQueues(weeklySheet?.priorAssignments ?? []);
  const driverNeighborhoodLookup = buildDriverNeighborhoodLookup(weeklySheet?.drivers ?? []);
  const rows: ExportRow[] = [];

  results.forEach(({ volunteer, route }, volunteerIndex) => {
    if (!route) return;
    const volunteerName = displayVolunteerName(volunteer.name, volunteerIndex);

    const deliveries = route.stops.filter((stop) => !stop.isFixed);
    deliveries.forEach((stop, index) => {
      const deliveryZip = zipFromAddress(stop.address);
      const queue = priorQueues.get(deliveryZip) ?? [];
      const prior = queue.shift();
      priorQueues.set(deliveryZip, queue);

      rows.push({
        thisWeekDriver: volunteerName,
        driverNeighborhood: volunteer.homeNeighborhood || driverNeighborhoodLookup.get(volunteerName) || '',
        deliveryZip,
        fullAddress: stop.address.sourceType === 'address' ? stop.address.formatted : '',
        routeOrder: index + 1,
        lastWeekDriver: prior?.volunteerName ?? '',
        lastWeekNeighborhood: prior?.neighborhood ?? '',
        newClient: prior ? '' : 'Yes',
        comments: '',
        routeLink: route.googleMapsUrl,
      });
    });
  });

  return rows.sort((a, b) => {
    if (a.thisWeekDriver !== b.thisWeekDriver) return a.thisWeekDriver.localeCompare(b.thisWeekDriver);
    if (a.routeOrder !== b.routeOrder) return a.routeOrder - b.routeOrder;
    return a.deliveryZip.localeCompare(b.deliveryZip);
  });
}

function buildDriverSummary(rows: ExportRow[], drivers: DeliverySheetDriver[]) {
  return drivers.map((driver) => {
    const assignedRows = rows.filter((row) => row.thisWeekDriver === driver.name);
    const uniqueZips = [...new Set(assignedRows.map((row) => row.deliveryZip))];
    const newClients = assignedRows.filter((row) => row.newClient === 'Yes').length;

    return {
      Driver: driver.name,
      Neighborhood: driver.neighborhood,
      Assigned: assignedRows.length,
      'ZIPs Assigned': uniqueZips.join(', '),
      'New Clients': newClients,
      Notes: '',
    };
  });
}

function buildFallbackDrivers(results: VolunteerRouteResult[]): DeliverySheetDriver[] {
  const seen = new Set<string>();
  const drivers: DeliverySheetDriver[] = [];

  results.forEach(({ volunteer }, index) => {
    const volunteerName = displayVolunteerName(volunteer.name, index);
    const key = volunteer.id || volunteerName;
    if (seen.has(key)) return;
    seen.add(key);
    drivers.push({
      name: volunteerName,
      neighborhood: volunteer.homeNeighborhood || volunteer.homeZipCode || volunteer.homeAddress?.formatted || '',
    });
  });

  return drivers;
}

function styleSheetHeaders(
  XLSX: Awaited<typeof import('xlsx-js-style')>,
  sheet: Record<string, unknown>,
  headerCount: number
) {
  for (let col = 0; col < headerCount; col++) {
    const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
    const cell = sheet[cellAddress] as { s?: unknown } | undefined;
    if (!cell) continue;
    cell.s = HEADER_STYLE;
  }
}

function highlightNewClientRows(
  XLSX: Awaited<typeof import('xlsx-js-style')>,
  sheet: Record<string, unknown>,
  rows: ExportRow[],
  columnsToHighlight: number[]
) {
  rows.forEach((row, index) => {
    if (row.newClient !== 'Yes') return;

    const excelRow = index + 1;
    columnsToHighlight.forEach((col) => {
      const address = XLSX.utils.encode_cell({ r: excelRow, c: col });
      const cell = sheet[address] as { s?: Record<string, unknown> } | undefined;
      if (!cell) return;
      cell.s = {
        ...(cell.s ?? {}),
        ...HIGHLIGHT_STYLE,
      };
    });
  });
}

function createWorksheetFromObjects(
  XLSX: Awaited<typeof import('xlsx-js-style')>,
  rows: Array<Record<string, CellValue>>
) {
  const sheet = XLSX.utils.json_to_sheet(rows) as Record<string, unknown>;
  const headerCount = Object.keys(rows[0] ?? {}).length;
  styleSheetHeaders(XLSX, sheet, headerCount);
  return sheet;
}

export async function exportWeeklySheetWorkbook(
  results: VolunteerRouteResult[],
  weeklySheet?: WeeklySheetContext
) {
  const XLSX = await import('xlsx-js-style');
  const deliveries = buildExportRows(results, weeklySheet);
  const summaryDrivers = weeklySheet?.drivers?.length
    ? weeklySheet.drivers
    : buildFallbackDrivers(results);
  const deliverySheetRows = deliveries.map((row) => ({
    'This Week Driver': row.thisWeekDriver,
    'Driver Neighborhood': row.driverNeighborhood,
    'Delivery ZIP': row.deliveryZip,
    'Full Address': row.fullAddress,
    'Route Order': row.routeOrder,
    'Last Week Driver': row.lastWeekDriver,
    'Last Week Neighborhood': row.lastWeekNeighborhood,
    'New Client?': row.newClient,
    Comments: row.comments,
    'Route Link': row.routeLink,
  }));

  const summaryRows = buildDriverSummary(deliveries, summaryDrivers);

  const workbook = XLSX.utils.book_new();
  const deliveriesSheet = createWorksheetFromObjects(XLSX, deliverySheetRows.length > 0 ? deliverySheetRows : [{
    'This Week Driver': '',
    'Driver Neighborhood': '',
    'Delivery ZIP': '',
    'Full Address': '',
    'Route Order': '',
    'Last Week Driver': '',
    'Last Week Neighborhood': '',
    'New Client?': '',
    Comments: '',
    'Route Link': '',
  }]);

  (deliveriesSheet as { ['!cols']?: Array<{ wch: number }>; ['!autofilter']?: { ref: string } })['!cols'] = [
    { wch: 20 },
    { wch: 20 },
    { wch: 12 },
    { wch: 42 },
    { wch: 12 },
    { wch: 20 },
    { wch: 20 },
    { wch: 12 },
    { wch: 28 },
    { wch: 50 },
  ];
  (deliveriesSheet as { ['!autofilter']?: { ref: string } })['!autofilter'] = { ref: 'A1:J1' };
  highlightNewClientRows(XLSX, deliveriesSheet, deliveries, [2, 7]);

  const summarySheet = createWorksheetFromObjects(XLSX, summaryRows.length > 0 ? summaryRows : [{
    Driver: '',
    Neighborhood: '',
    Assigned: '',
    'ZIPs Assigned': '',
    'New Clients': '',
    Notes: '',
  }]);
  (summarySheet as { ['!cols']?: Array<{ wch: number }>; ['!autofilter']?: { ref: string } })['!cols'] = [
    { wch: 22 },
    { wch: 18 },
    { wch: 10 },
    { wch: 28 },
    { wch: 12 },
    { wch: 24 },
  ];
  (summarySheet as { ['!autofilter']?: { ref: string } })['!autofilter'] = { ref: 'A1:F1' };

  XLSX.utils.book_append_sheet(workbook, deliveriesSheet as never, 'Deliveries');
  XLSX.utils.book_append_sheet(workbook, summarySheet as never, 'Driver Summary');

  const tabName = weeklySheet?.source?.tabName?.replace(/[\\/:*?"<>|]/g, '-').trim() || 'routes';
  XLSX.writeFile(workbook, `${tabName}-export.xlsx`);
}
