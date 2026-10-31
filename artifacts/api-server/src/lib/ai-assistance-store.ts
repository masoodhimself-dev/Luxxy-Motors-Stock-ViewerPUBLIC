import { randomUUID } from "node:crypto";
import {
  AiError,
  AI_MONTHLY_MICRO_USD,
  AI_RESERVATION_MICRO_USD,
  type AiResult,
} from "./ai-assistance";
type Client = {
  query: (text: string, values?: any[]) => Promise<{ rows: any[] }>;
  release: () => void;
};
type Database = { connect: () => Promise<Client>; query: Client["query"] };
export class AiAssistanceStore {
  private cleanedAt = 0;
  constructor(private database: Database) {}
  async cleanup() {
    if (this.cleanedAt > Date.now() - 3600000) return;
    await this.database.query(
      "DELETE FROM ai_assistance_cache WHERE expires_at<now()",
    );
    await this.database.query(
      "UPDATE ai_assistance_requests SET result=NULL WHERE result IS NOT NULL AND created_at<now()-interval '24 hours'",
    );
    await this.database.query(
      "UPDATE ai_assistance_requests SET status='failed' WHERE status='reserved' AND created_at<now()-interval '1 minute'",
    );
    await this.database.query(
      "DELETE FROM ai_assistance_requests WHERE created_at<now()-interval '90 days'",
    );
    await this.database.query(
      "DELETE FROM ai_browser_sessions WHERE expires_at<now()-interval '90 days'",
    );
    this.cleanedAt = Date.now();
  }
  async remaining(dealer: string, session: string) {
    const r = await this.database.query(
      "SELECT used_count,expires_at FROM ai_browser_sessions WHERE token_hash=$1 AND dealer_id=$2",
      [session, dealer],
    );
    return r.rows[0]
      ? new Date(r.rows[0].expires_at).getTime() <= Date.now()
        ? 0
        : Math.max(0, 10 - r.rows[0].used_count)
      : 10;
  }
  async reserve(input: {
    dealer: string;
    session: string;
    ip: string;
    requestId: string;
    hash: string;
    cacheKey: string | null;
    staff: boolean;
  }) {
    await this.cleanup();
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      // Serialise only short admission transactions across every instance/dealer.
      await client.query(
        "LOCK TABLE ai_assistance_requests, ai_browser_sessions IN SHARE ROW EXCLUSIVE MODE",
      );
      const old = (
        await client.query(
          "SELECT * FROM ai_assistance_requests WHERE dealer_id=$1 AND session_hash=$2 AND request_id=$3",
          [input.dealer, input.session, input.requestId],
        )
      ).rows[0];
      if (old) {
        if (old.request_hash !== input.hash)
          throw new AiError(
            "request_conflict",
            "Start a new request for changed text.",
            409,
          );
        if (
          old.status !== "succeeded" ||
          !old.result ||
          new Date(old.created_at).getTime() < Date.now() - 86400000
        )
          throw new AiError(
            "request_used",
            "That request is pending or could not complete. It will not be sent again.",
            409,
          );
        await client.query("COMMIT");
        return {
          id: old.id,
          cached: old.result as AiResult,
          remaining: await this.remaining(input.dealer, input.session),
        };
      }
      await client.query(
        "INSERT INTO ai_browser_sessions(token_hash,dealer_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [input.session, input.dealer],
      );
      const session = (
        await client.query(
          "SELECT * FROM ai_browser_sessions WHERE token_hash=$1 AND dealer_id=$2",
          [input.session, input.dealer],
        )
      ).rows[0];
      if (
        !session ||
        new Date(session.expires_at).getTime() <= Date.now() ||
        session.used_count >= 10
      )
        throw new AiError(
          "session_limit",
          "You’ve used your 10 AI requests for this browser session. Saved answers, search filters and enquiries still work.",
          429,
        );
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/London",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      const day = (
        await client.query(
          "SELECT count(*)::int AS count FROM ai_assistance_requests WHERE ip_hash=$1 AND created_at>=now()-interval '24 hours'",
          [input.ip],
        )
      ).rows[0].count;
      if (day >= 30)
        throw new AiError(
          "daily_limit",
          "AI has reached its daily allowance for this connection. Please use the normal search or enquiry options.",
          429,
        );
      const cache = input.cacheKey
        ? ((
            await client.query(
              "SELECT result FROM ai_assistance_cache WHERE dealer_id=$1 AND cache_key=$2 AND expires_at>now()",
              [input.dealer, input.cacheKey],
            )
          ).rows[0]?.result ?? null)
        : null;
      if (!cache) {
        const spend = Number(
          (
            await client.query(
              "SELECT coalesce(sum(cost_micro_usd),0) AS spent FROM ai_assistance_requests WHERE month_key=$1",
              [today.slice(0, 7)],
            )
          ).rows[0].spent,
        );
        if (spend + AI_RESERVATION_MICRO_USD > AI_MONTHLY_MICRO_USD)
          throw new AiError(
            "budget_limit",
            "The monthly AI allowance has been reached. Normal search and enquiries are still available.",
            429,
          );
        if (
          input.cacheKey &&
          (
            await client.query(
              "SELECT id FROM ai_assistance_requests WHERE dealer_id=$1 AND cache_key=$2 AND status='reserved' LIMIT 1",
              [input.dealer, input.cacheKey],
            )
          ).rows.length
        )
          throw new AiError(
            "generation_pending",
            "This answer is already being prepared. Please try again shortly.",
            409,
          );
      }
      const id = randomUUID();
      await client.query(
        "UPDATE ai_browser_sessions SET used_count=used_count+1 WHERE token_hash=$1",
        [input.session],
      );
      await client.query(
        "INSERT INTO ai_assistance_requests(id,dealer_id,session_hash,ip_hash,request_id,request_hash,cache_key,month_key,cost_micro_usd,status,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [
          id,
          input.dealer,
          input.session,
          input.ip,
          input.requestId,
          input.hash,
          input.cacheKey,
          today.slice(0, 7),
          cache ? 0 : AI_RESERVATION_MICRO_USD,
          cache ? "succeeded" : "reserved",
          cache ? JSON.stringify(cache) : null,
        ],
      );
      await client.query("COMMIT");
      return {
        id,
        cached: cache as AiResult | null,
        remaining: 9 - session.used_count,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async complete(
    id: string,
    dealer: string,
    result: AiResult,
    cost: number,
    cacheKey: string | null,
  ) {
    const c = await this.database.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        "UPDATE ai_assistance_requests SET status='succeeded',result=$3,cost_micro_usd=$4 WHERE id=$1 AND dealer_id=$2 AND status='reserved'",
        [id, dealer, JSON.stringify(result), cost],
      );
      if (cacheKey)
        await c.query(
          "INSERT INTO ai_assistance_cache(dealer_id,cache_key,result,expires_at) VALUES($1,$2,$3,now()+interval '1 hour') ON CONFLICT(dealer_id,cache_key) DO UPDATE SET result=excluded.result,expires_at=excluded.expires_at",
          [dealer, cacheKey, JSON.stringify(result)],
        );
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async fail(id: string, dealer: string) {
    await this.database.query(
      "UPDATE ai_assistance_requests SET status='failed',result=NULL WHERE id=$1 AND dealer_id=$2 AND status='reserved'",
      [id, dealer],
    );
  }
}
