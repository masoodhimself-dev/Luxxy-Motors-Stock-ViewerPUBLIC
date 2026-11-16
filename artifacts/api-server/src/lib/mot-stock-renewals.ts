import type { MotHistory, MotTest } from "@workspace/vehicle-meta";

type ObservationSql = {
  query(text: string, values?: any[]): Promise<{ rows: any[] }>;
};
type PassingTest = { testDate: string; expiryDate: string; test: MotTest };
type Observation = {
  registration: string;
  checked_at: Date | string;
  test_date: string | null;
  expiry_date: string | null;
};

const londonDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function dateKey(value: unknown) {
  if (typeof value !== "string") return null;
  const date = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith("0000-")) return null;
  const timestamp = Date.parse(date);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().startsWith(date)
    ? date
    : null;
}

function latestPassingTest(history: MotHistory, checkedDay: string): PassingTest | null {
  let latest: PassingTest | null = null;
  for (const test of history.tests) {
    if (test?.result !== "PASSED") continue;
    const testDate = dateKey(test.completedDate);
    const expiryDate = dateKey(test.expiryDate);
    if (!testDate || !expiryDate || testDate > checkedDay || expiryDate < testDate) continue;
    if (!latest || testDate > latest.testDate ||
        (testDate === latest.testDate && expiryDate > latest.expiryDate)) {
      latest = { testDate, expiryDate, test };
    }
  }
  return latest;
}

export function motTestAdvisories(test: MotTest): string[] {
  return (test.defects ?? [])
    .filter(defect => defect.type.trim().toUpperCase() === "ADVISORY")
    .map(defect => defect.text.trim())
    .filter(Boolean);
}

/** Record successful DVSA history inside the stock worker's dealer transaction. */
export async function observeStockMotRenewal(
  client: ObservationSql,
  dealerId: string,
  vehicleId: string,
  history: MotHistory,
) {
  const checkedAt = new Date(history.checkedAt);
  if (!Number.isFinite(checkedAt.getTime())) return;
  const checkedDay = londonDate.format(checkedAt);
  const passing = latestPassingTest(history, checkedDay);
  const [saved] = (await client.query(
    `SELECT registration,checked_at,test_date::text,expiry_date::text
       FROM mot_stock_renewal_observations
       WHERE dealer_id=$1 AND vehicle_id=$2 FOR UPDATE`,
    [dealerId, vehicleId],
  )).rows as Observation[];
  const previous = saved?.registration === history.registration ? saved : null;
  if (previous && checkedAt.getTime() <= new Date(previous.checked_at).getTime()) return;

  let testDate = previous?.test_date ?? null;
  let expiryDate = previous?.expiry_date ?? null;
  if (passing && (!testDate || passing.testDate >= testDate)) {
    const extendsExistingMot = testDate && expiryDate &&
      passing.testDate > testDate && passing.expiryDate > expiryDate;
    const firstObservedPass = previous && !testDate &&
      passing.testDate >= londonDate.format(new Date(previous.checked_at));
    if (previous && passing.expiryDate >= checkedDay && (extendsExistingMot || firstObservedPass)) {
      await client.query(
        `INSERT INTO mot_stock_renewal_notices(dealer_id,vehicle_id,registration,expiry_date,advisories)
         VALUES($1,$2,$3,$4,$5::text[]) ON CONFLICT DO NOTHING`,
        [dealerId, vehicleId, history.registration, passing.expiryDate, motTestAdvisories(passing.test)],
      );
    }
    testDate = passing.testDate;
    if (!expiryDate || passing.expiryDate > expiryDate) expiryDate = passing.expiryDate;
  }

  await client.query(
    `INSERT INTO mot_stock_renewal_observations(dealer_id,vehicle_id,registration,checked_at,test_date,expiry_date)
     VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(dealer_id,vehicle_id) DO UPDATE SET registration=excluded.registration,
       checked_at=excluded.checked_at,test_date=excluded.test_date,expiry_date=excluded.expiry_date`,
    [dealerId, vehicleId, history.registration, checkedAt, testDate, expiryDate],
  );
}

/** On returning to the feed, a vehicle starts with a new baseline. */
export async function resetStockMotRenewalObservations(
  client: ObservationSql,
  dealerId: string,
  eligibleVehicleIds: readonly string[],
) {
  const ids = [...eligibleVehicleIds];
  await client.query(
    `DELETE FROM mot_stock_renewal_observations
     WHERE dealer_id=$1 AND NOT(vehicle_id=ANY($2::uuid[]))`,
    [dealerId, ids],
  );
  await client.query(
    `UPDATE mot_stock_renewal_notices SET status='skipped',payload=NULL,account_hash=NULL
     WHERE dealer_id=$1 AND status='queued' AND attempts=0 AND claim_token IS NULL
       AND NOT(vehicle_id=ANY($2::uuid[]))`,
    [dealerId, ids],
  );
}
