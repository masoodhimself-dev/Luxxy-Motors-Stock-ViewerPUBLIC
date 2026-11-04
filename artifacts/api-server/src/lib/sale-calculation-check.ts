import { createHash, randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import { SaleWorkspaceError, saleCalculationSnapshot, type SaleCalculationCheckResult, type SaleCalculationSnapshot, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { currentDealerId } from './tenant-context';
import { AI_MODEL, AI_RESERVATION_MICRO_USD, aiConfigured, type AiResult } from './ai-assistance';
import { AiAssistanceStore } from './ai-assistance-store';
import type { SaleWorkspaceDatabase } from './sale-workspace-store';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pendingChecks = new Map<string, Promise<SaleCalculationCheckResult>>();
export const calculationMessage = {
  checked: 'The total and balance add up.',
  attention: 'AI found a possible difference. Check the total and balance before continuing.',
  unavailable: 'The amounts have been calculated. AI could not double-check them. You can continue.',
} as const;

/** Strictly numeric input and output. There is no review of people, vehicles, terms or staff decisions. */
export function saleCalculationPrompt(snapshot: SaleCalculationSnapshot) {
  const { totals: _expectedTotals, ...amounts } = snapshot;
  return {
    model: AI_MODEL, service_tier: 'default', reasoning: { effort: 'none' }, store: false, max_output_tokens: 400,
    instructions: 'Double-check ONLY this arithmetic in integer pence. totalDuePence = pricePence + sum(feesPence) - sum(discountsPence) + deliveryPence - sum(allowancesPence) - returnCreditPence. confirmedPaidPence = sum(confirmedPaymentsPence) + sum(transferredCreditsPence). pendingPence = sum(pendingPaymentsPence); pending money does NOT reduce the balance. balancePence = totalDuePence - confirmedPaidPence. Refunds and reversed payments are signed negatives. Negative balance is money owed back to the customer and is a valid result. Return your independently computed four integers only. No advice, other checks, tool calls, or actions. The application remains responsible for exact arithmetic.',
    input: JSON.stringify(amounts),
    text: { format: { type: 'json_schema', name: 'sale_calculations', strict: true, schema: {
      type: 'object', additionalProperties: false,
      properties: { totalDuePence: { type: 'integer' }, confirmedPaidPence: { type: 'integer' }, pendingPence: { type: 'integer' }, balancePence: { type: 'integer' } },
      required: ['totalDuePence', 'confirmedPaidPence', 'pendingPence', 'balancePence'],
    } } },
  };
}
function parseCached(value: AiResult | undefined | null, financialKey: string, snapshot: SaleCalculationSnapshot): SaleCalculationCheckResult | null {
  try {
    const result = JSON.parse(value?.answer ?? '') as SaleCalculationCheckResult;
    if (result.financialKey !== financialKey || !['checked', 'attention'].includes(result.status) || !Number.isFinite(Date.parse(result.checkedAt)) || !result.totals || Object.entries(snapshot.totals).some(([key, value]) => result.totals[key as keyof typeof result.totals] !== value)) return null;
    return { status: result.status, financialKey, totals: snapshot.totals, checkedAt: result.checkedAt, message: calculationMessage[result.status], cached: true };
  } catch { return null; }
}

/** Read-only to the sale: neither a check nor its failure changes revision, payments, documents or stock. */
export async function runSaleCalculationCheck(id: string, input: Record<string, unknown>, actor: string, options: { database?: SaleWorkspaceDatabase; fetcher?: typeof fetch; configured?: () => boolean } = {}): Promise<SaleCalculationCheckResult> {
  const dealer = currentDealerId(), database = options.database ?? pool;
  const sale = (await database.query('SELECT state FROM sale_workspace WHERE dealer_id=$1 AND id=$2::uuid', [dealer, id])).rows[0]?.state as SaleWorkspaceRecord | undefined;
  if (!sale) throw new SaleWorkspaceError('Sale not found.', 404);
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== sale.revision) throw new SaleWorkspaceError('The sale changed. Reload it before previewing.', 409);
  const snapshot = saleCalculationSnapshot(sale, input.figures), financialKey = hash(snapshot);
  const cacheKey = `sale-calculation:v1:${id}:${financialKey}`, scope = `${dealer}:${cacheKey}`;
  const base = { financialKey, totals: snapshot.totals, checkedAt: new Date().toISOString(), cached: false };
  const unavailable = (): SaleCalculationCheckResult => ({ ...base, status: 'unavailable', message: calculationMessage.unavailable });
  // Same dealer + same sale + same numeric content reuse a result, including after non-financial edits.
  try {
    const cached = parseCached((await database.query('SELECT result FROM ai_assistance_cache WHERE dealer_id=$1 AND cache_key=$2 AND expires_at>now()', [dealer, cacheKey])).rows[0]?.result, financialKey, snapshot);
    if (cached) return cached;
  } catch { return unavailable(); }
  if (!(options.configured ?? aiConfigured)()) return unavailable();
  const running = pendingChecks.get(scope);
  if (running) return { ...await running, cached: true };
  if (pendingChecks.size >= 2) return unavailable();
  const work = async (): Promise<SaleCalculationCheckResult> => {
    const store = new AiAssistanceStore(database);
    let admissionId: string | undefined;
    try {
      const payload = saleCalculationPrompt(snapshot);
      if (Buffer.byteLength(JSON.stringify(payload)) > 40000) return unavailable();
      const now = new Date().toISOString();
      const admission = await store.reserve({ dealer, session: hash(['sale-calculation', dealer, actor, now.slice(0, 13)]), ip: hash(['sale-calculation', dealer, actor, now.slice(0, 10)]), requestId: randomUUID(), hash: hash(payload), cacheKey, staff: true });
      if (admission.cached) return parseCached(admission.cached, financialKey, snapshot) ?? unavailable();
      admissionId = admission.id;
      const response = await (options.fetcher ?? fetch)('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('Calculation check unavailable');
      const body = await response.json() as any;
      if (body.status !== 'completed') throw new Error('Calculation check incomplete');
      const computed = JSON.parse(body.output?.flatMap((item: any) => item.content ?? []).filter((item: any) => item.type === 'output_text').map((item: any) => item.text).join(''));
      const expected = { totalDuePence: snapshot.totals.totalDue, confirmedPaidPence: snapshot.totals.confirmedPaid, pendingPence: snapshot.totals.pending, balancePence: snapshot.totals.balance };
      if (!computed || typeof computed !== 'object' || Object.keys(computed).length !== 4 || Object.keys(expected).some(key => !Number.isSafeInteger(computed[key]))) throw new Error('Invalid calculation result');
      const status = Object.entries(expected).every(([key, value]) => computed[key] === value) ? 'checked' : 'attention';
      const result: SaleCalculationCheckResult = { ...base, checkedAt: new Date().toISOString(), status, message: calculationMessage[status] };
      await store.complete(admissionId!, dealer, { answer: JSON.stringify(result), vehicleIds: [], questions: [], evidence: [] }, AI_RESERVATION_MICRO_USD, cacheKey);
      return result;
    } catch {
      if (admissionId) await store.fail(admissionId, dealer).catch(() => {});
      return unavailable();
    }
  };
  const promise = work();
  pendingChecks.set(scope, promise);
  try { return await promise; } finally { pendingChecks.delete(scope); }
}
