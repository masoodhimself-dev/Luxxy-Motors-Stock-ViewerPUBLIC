import { createHash } from 'node:crypto';
import { pool } from '@workspace/db';
import { z } from 'zod/v4';
import { currentDealerId } from './tenant-context';
import { siteUrl } from './enquiry-links';
import type { SettingsDatabase, SettingsQueryClient } from './settings-versions';

export const testDriveStatementVersion = '2026-10-18-v1';
export const testDriveStatement = `Before taking this vehicle on a test drive, I confirm that:

• I hold a current driving licence that permits me to drive this vehicle, and I will show it to the dealership before driving.
• I have told the dealership about any licence restrictions or other information it asks for when checking whether I may drive and whether its insurance applies.
• I am fit to drive and am not impaired by alcohol, drugs, medication or illness.
• I will follow road traffic rules, the agreed route and the dealership's reasonable instructions, and will not let anyone else drive without its agreement.
• I will report any collision, damage, warning light or other concern to the dealership promptly and stop safely when necessary.

The dealership must separately check my licence, any identity requirements and the applicable insurance before allowing the test drive. Signing this declaration does not provide insurance cover, confirm insurer approval or replace those checks. It does not waive statutory rights or decide liability for an accident.

By typing my name and selecting the confirmation, I confirm that I have read this declaration and that the statements above are true to the best of my knowledge.`;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const testDriveStatementHash = digest(testDriveStatement);
const token = z.string().regex(/^[a-f0-9]{64}$/);
export const createTestDriveDeclarationInput = z.object({ requestId: z.uuid(), token, expectedAppointmentRevision: z.number().int().nonnegative(), expectedVehicleId: z.uuid(), expiresHours: z.number().int().min(1).max(168).default(48) }).strict();
export const acceptTestDriveDeclarationInput = z.object({
  requestId: z.uuid(), signerName: z.string().trim().min(2).max(120).refine(value => !/[\u0000-\u001f\u007f]/.test(value)),
  accepted: z.literal(true), statementVersion: z.string().min(1).max(100), statementHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const testDriveChecksInput = z.object({ expectedRevision: z.number().int().nonnegative(), licenceChecked: z.boolean(), insuranceChecked: z.boolean() }).strict();
export type DeclarationSnapshot = { dealerName: string; customerName: string; enquiryReference: string; vehicleId: string; vehicle: { title: string; registration: string | null }; appointmentAt: string; durationMinutes: number; appointmentRevision: number };
export type DeclarationStatus = 'pending' | 'signed' | 'revoked' | 'expired' | 'superseded';
export type StaffTestDriveDeclaration = {
  id: string; status: DeclarationStatus; current: boolean; revision: number; createdAt: string; expiresAt: string; signedAt: string | null; signerName: string | null;
  snapshot: DeclarationSnapshot; statementVersion: string; statement: string; statementHash: string; revokedAt: string | null;
  staffChecks: { licenceChecked: boolean; insuranceChecked: boolean; checkedAt: string | null; checkedBy: string | null };
};
export class TestDriveDeclarationError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
type Row = Record<string, any>;
const iso = (value: unknown) => value ? new Date(value as string).toISOString() : null;
function snapshot(context: Row): DeclarationSnapshot {
  return { dealerName: context.dealerName, customerName: context.customer_name, enquiryReference: context.reference, vehicleId: context.vehicle_id,
    vehicle: { title: context.car.website_title_override || context.car.title, registration: context.car.plate || context.car.vrm || context.car.registration || null },
    appointmentAt: iso(context.appointment_at)!, durationMinutes: context.appointment_duration_minutes ?? 30, appointmentRevision: context.appointment_revision };
}
function contextHash(context: Row) {
  return digest(JSON.stringify({ ...snapshot(context), status: context.appointment_status, cancelled: iso(context.appointment_cancelled_at), mergedInto: context.merged_into_id, enquiryStatus: context.status }));
}
function active(context: Row | null, now = Date.now()): context is Row {
  return Boolean(context?.appointment_at && context.car && context.appointment_status === 'confirmed' && !context.appointment_cancelled_at && !context.merged_into_id && context.status !== 'closed' && !context.car.archived_at && ['available', 'reserved'].includes(context.car.inventory_status) && now < new Date(context.appointment_at).getTime() + ((context.appointment_duration_minutes ?? 30) + 120) * 60000);
}
function unusableStatus(row: Row, context: Row | null): DeclarationStatus | null {
  if (row.revoked_at) return 'revoked';
  if (!active(context) || contextHash(context) !== row.context_hash) return 'superseded';
  if (new Date(row.expires_at).getTime() <= Date.now()) return 'expired';
  return null;
}
function staffView(row: Row, context: Row | null): StaffTestDriveDeclaration {
  const unusable = unusableStatus(row, context);
  // Link expiry limits access and new signing; it does not cancel an acceptance
  // already recorded for the same still-current appointment and vehicle.
  const current = unusable === null || (Boolean(row.signed_at) && unusable === 'expired');
  return { id: row.id, status: row.revoked_at ? 'revoked' : row.signed_at ? 'signed' : unusable ?? 'pending', current, revision: row.revision, createdAt: iso(row.created_at)!, expiresAt: iso(row.expires_at)!, signedAt: iso(row.signed_at), signerName: row.signer_name,
    snapshot: row.snapshot, statementVersion: row.statement_version, statement: row.statement, statementHash: row.statement_hash, revokedAt: iso(row.revoked_at),
    staffChecks: { licenceChecked: row.licence_checked, insuranceChecked: row.insurance_checked, checkedAt: iso(row.checks_updated_at), checkedBy: row.checks_updated_by } };
}

/** A typed-name declaration records what was accepted; it is not identity or insurance verification. */
export class PostgresTestDriveDeclarations {
  constructor(private readonly database: SettingsDatabase = pool) {}
  private async context(client: SettingsQueryClient, enquiryId: string, lock = false): Promise<Row | null> {
    const row = (await client.query(`SELECT * FROM enquiries WHERE dealer_id=$1 AND id=$2 ${lock ? 'FOR UPDATE' : ''}`, [currentDealerId(), enquiryId])).rows[0];
    if (!row) return null;
    const car = row.vehicle_id ? (await client.query(`SELECT title,website_title_override,plate,vrm,registration,inventory_status,archived_at FROM vehicles WHERE dealer_id=$1 AND id=$2 ${lock ? 'FOR SHARE' : ''}`, [currentDealerId(), row.vehicle_id])).rows[0] : null;
    const config = (await client.query('SELECT config FROM dealer_settings WHERE dealer_id=$1', [currentDealerId()])).rows[0]?.config;
    return { ...row, car, dealerName: config?.identity?.name || 'The dealership' };
  }
  private async transaction<T>(enquiryId: string, work: (client: SettingsQueryClient, context: Row | null) => Promise<T>): Promise<T> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`test-drive-declaration:${currentDealerId()}:${enquiryId}`]);
      const context = await this.context(client, enquiryId, true);
      const result = await work(client, context);
      await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async list(enquiryId: string) {
    const context = await this.context(this.database, enquiryId);
    if (!context) throw new TestDriveDeclarationError('Enquiry not found.', 404);
    const rows = (await this.database.query('SELECT * FROM test_drive_declarations WHERE dealer_id=$1 AND enquiry_id=$2 ORDER BY created_at DESC LIMIT 30', [currentDealerId(), enquiryId])).rows;
    return { declarations: rows.map(row => staffView(row, context)), currentAppointmentRevision: context.appointment_revision };
  }
  async create(enquiryId: string, raw: unknown, actor: string) {
    const input = createTestDriveDeclarationInput.parse(raw), createHash = digest(JSON.stringify(input));
    return this.transaction(enquiryId, async (client, context) => {
      if (!context) throw new TestDriveDeclarationError('Enquiry not found.', 404);
      const prior = (await client.query('SELECT * FROM test_drive_declarations WHERE dealer_id=$1 AND request_id=$2', [currentDealerId(), input.requestId])).rows[0];
      if (prior) {
        if (prior.enquiry_id !== enquiryId || prior.create_hash !== createHash) throw new TestDriveDeclarationError('This request was used for different declaration details.', 409);
        return { declaration: staffView(prior, context), url: siteUrl(`/test-drive-declaration/${input.token}`), replayed: true };
      }
      if (input.expectedAppointmentRevision !== context.appointment_revision || input.expectedVehicleId !== context.vehicle_id) throw new TestDriveDeclarationError('The appointment or vehicle changed. Refresh the booking before creating a declaration.', 409);
      if (!active(context)) throw new TestDriveDeclarationError('Choose a confirmed, active appointment and an available or reserved stock car first.', 409);
      const now = new Date(), expiresAt = new Date(Math.min(now.getTime() + input.expiresHours * 3600000, new Date(context.appointment_at).getTime() + ((context.appointment_duration_minutes ?? 30) + 120) * 60000));
      await client.query('UPDATE test_drive_declarations SET revoked_at=$3,revoked_by=$4,revision=revision+1 WHERE dealer_id=$1 AND enquiry_id=$2 AND revoked_at IS NULL AND signed_at IS NULL', [currentDealerId(), enquiryId, now, actor]);
      const row = (await client.query(`INSERT INTO test_drive_declarations(dealer_id,enquiry_id,vehicle_id,request_id,token_hash,create_hash,appointment_revision,snapshot,context_hash,statement_version,statement,statement_hash,created_at,created_by,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15) RETURNING *`, [currentDealerId(), enquiryId, context.vehicle_id, input.requestId, digest(input.token), createHash, context.appointment_revision, JSON.stringify(snapshot(context)), contextHash(context), testDriveStatementVersion, testDriveStatement, testDriveStatementHash, now, actor, expiresAt])).rows[0];
      return { declaration: staffView(row, context), url: siteUrl(`/test-drive-declaration/${input.token}`), replayed: false };
    });
  }
  async revoke(enquiryId: string, declarationId: string, actor: string) {
    return this.transaction(enquiryId, async (client, context) => {
      if (!context) throw new TestDriveDeclarationError('Enquiry not found.', 404);
      const result = await client.query('UPDATE test_drive_declarations SET revoked_at=coalesce(revoked_at,now()),revoked_by=coalesce(revoked_by,$4),revision=CASE WHEN revoked_at IS NULL THEN revision+1 ELSE revision END WHERE dealer_id=$1 AND enquiry_id=$2 AND id=$3 RETURNING id', [currentDealerId(), enquiryId, declarationId, actor]);
      if (!result.rows.length) throw new TestDriveDeclarationError('Declaration not found.', 404);
      return { revoked: true };
    });
  }
  async checks(enquiryId: string, declarationId: string, raw: unknown, actor: string) {
    const input = testDriveChecksInput.parse(raw);
    return this.transaction(enquiryId, async (client, context) => {
      const row = (await client.query('SELECT * FROM test_drive_declarations WHERE dealer_id=$1 AND enquiry_id=$2 AND id=$3 FOR UPDATE', [currentDealerId(), enquiryId, declarationId])).rows[0];
      if (!context || !row) throw new TestDriveDeclarationError('Declaration not found.', 404);
      if (!row.signed_at || unusableStatus(row, context) !== 'expired') this.usable(row, context);
      if (input.expectedRevision !== row.revision) throw new TestDriveDeclarationError('Declaration changed. Refresh before recording checks.', 409);
      const saved = (await client.query('UPDATE test_drive_declarations SET licence_checked=$4,insurance_checked=$5,checks_updated_at=now(),checks_updated_by=$6,revision=revision+1 WHERE dealer_id=$1 AND enquiry_id=$2 AND id=$3 RETURNING *', [currentDealerId(), enquiryId, declarationId, input.licenceChecked, input.insuranceChecked, actor])).rows[0];
      return { declaration: staffView(saved, context) };
    });
  }
  private usable(row: Row, context: Row | null) {
    const state = unusableStatus(row, context);
    if (state === 'superseded') throw new TestDriveDeclarationError('The appointment or car details changed. Ask the showroom for a new declaration link.', 409);
    if (state === 'expired' || state === 'revoked') throw new TestDriveDeclarationError('This declaration link is expired or withdrawn. Ask the showroom for a new link.', 410);
  }
  private async find(raw: unknown) {
    const parsed = token.safeParse(raw);
    const row = parsed.success ? (await this.database.query('SELECT * FROM test_drive_declarations WHERE dealer_id=$1 AND token_hash=$2', [currentDealerId(), digest(parsed.data)])).rows[0] : null;
    if (!row) throw new TestDriveDeclarationError('Declaration link not found.', 404);
    return row;
  }
  async read(tokenValue: string) {
    const row = await this.find(tokenValue), context = await this.context(this.database, row.enquiry_id);
    this.usable(row, context);
    const saved = row.snapshot as DeclarationSnapshot;
    return { status: row.signed_at ? 'signed' : 'pending', dealerName: saved.dealerName, vehicle: saved.vehicle, appointmentAt: saved.appointmentAt, durationMinutes: saved.durationMinutes,
      statementVersion: row.statement_version, statement: row.statement, statementHash: row.statement_hash, expiresAt: iso(row.expires_at), signedAt: iso(row.signed_at) };
  }
  async accept(tokenValue: string, raw: unknown) {
    const input = acceptTestDriveDeclarationInput.parse(raw), found = await this.find(tokenValue), acceptanceHash = digest(JSON.stringify(input));
    return this.transaction(found.enquiry_id, async (client, context) => {
      const row = (await client.query('SELECT * FROM test_drive_declarations WHERE dealer_id=$1 AND id=$2 FOR UPDATE', [currentDealerId(), found.id])).rows[0];
      if (!row) throw new TestDriveDeclarationError('Declaration link not found.', 404);
      this.usable(row, context);
      if (input.statementVersion !== row.statement_version || input.statementHash !== row.statement_hash) throw new TestDriveDeclarationError('The declaration changed. Reload it before signing.', 409);
      if (row.signed_at) {
        if (row.acceptance_request_id !== input.requestId || row.acceptance_hash !== acceptanceHash) throw new TestDriveDeclarationError('This declaration has already been signed. The saved acceptance has not changed.', 409);
        return { status: 'signed', signedAt: iso(row.signed_at), replayed: true };
      }
      const signed = (await client.query('UPDATE test_drive_declarations SET signed_at=now(),signer_name=$3,acceptance_request_id=$4,acceptance_hash=$5,revision=revision+1 WHERE dealer_id=$1 AND id=$2 RETURNING signed_at', [currentDealerId(), row.id, input.signerName, input.requestId, acceptanceHash])).rows[0];
      return { status: 'signed', signedAt: iso(signed.signed_at), replayed: false };
    });
  }
}
export type TestDriveDeclarationService = Pick<PostgresTestDriveDeclarations, 'list' | 'create' | 'revoke' | 'checks' | 'read' | 'accept'>;
