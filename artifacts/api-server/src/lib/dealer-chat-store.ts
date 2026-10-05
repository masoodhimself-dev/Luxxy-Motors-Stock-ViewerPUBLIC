import {
  emptyChatState,
  type ChatEnquiryInput,
  type ChatState,
  type ChatStore,
  type ChatTransaction,
} from "./dealer-chat";
export type ChatQueryClient = {
  query: (sql: string, params?: any[]) => Promise<{ rows: any[] }>;
};
export type ChatPool = ChatQueryClient & {
  connect: () => Promise<ChatQueryClient & { release: () => void }>;
};

/** The dealer row lock makes message, contact and enquiry updates one transaction. */
export class PostgresChatStore implements ChatStore {
  constructor(private database: ChatPool) {}
  async read(dealerId: string): Promise<ChatState> {
    return (
      (
        await this.database.query(
          "SELECT state FROM dealer_chat WHERE dealer_id=$1",
          [dealerId],
        )
      ).rows[0]?.state ?? emptyChatState()
    );
  }
  async transaction<T>(
    dealerId: string,
    work: (tx: ChatTransaction) => Promise<T>,
  ): Promise<T> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO dealer_chat(dealer_id,state) VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING",
        [dealerId, JSON.stringify(emptyChatState())],
      );
      const state = (
        await client.query(
          "SELECT state FROM dealer_chat WHERE dealer_id=$1 FOR UPDATE",
          [dealerId],
        )
      ).rows[0].state as ChatState;
      const result = await work({
        state,
        saveEnquiry: (input) => saveChatEnquiry(dealerId, input, client),
      });
      await client.query(
        "UPDATE dealer_chat SET state=$2::jsonb,updated_at=now() WHERE dealer_id=$1",
        [dealerId, JSON.stringify(state)],
      );
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
async function saveChatEnquiry(
  dealerId: string,
  input: ChatEnquiryInput,
  client: ChatQueryClient,
) {
  const car = input.vehicle;
  await client.query(
    `INSERT INTO enquiries(id,dealer_id,reference,vehicle_id,vehicle_title,vehicle_registration,vehicle_price,vehicle_url,type,status,
    customer_name,email,phone,preferred_contact,message,staff_note,source,created_at,updated_at)
    VALUES($1::uuid,$2,$3,(SELECT id FROM vehicles WHERE id=$4::uuid AND dealer_id=$2),$5,$6,$7,$8,'general','new',$9,$10,$11,$12,$13,$14,'chat',$15,now())
    ON CONFLICT(id) DO UPDATE SET customer_name=EXCLUDED.customer_name,email=EXCLUDED.email,phone=EXCLUDED.phone,
    preferred_contact=EXCLUDED.preferred_contact,message=EXCLUDED.message,workspace_revision=enquiries.workspace_revision+1,
    staff_note=CASE WHEN $16::boolean AND position('Customer requested a callback in website chat.' in coalesce(enquiries.staff_note,''))=0
    THEN concat_ws(E'\\n',nullif(enquiries.staff_note,''),'Customer requested a callback in website chat.') ELSE enquiries.staff_note END,updated_at=now()
    WHERE enquiries.dealer_id=EXCLUDED.dealer_id AND enquiries.source='chat'`,
    [
      input.id,
      dealerId,
      input.reference,
      car?.id ?? null,
      car?.title ?? null,
      car?.registration ?? null,
      car?.price ?? null,
      car?.url ?? null,
      input.name,
      input.email,
      input.phone,
      input.callbackRequested ? "phone" : input.email ? "email" : "phone",
      input.message,
      input.callbackRequested
        ? "Customer requested a callback in website chat."
        : "Customer shared contact details in website chat.",
      input.createdAt,
      input.callbackRequested,
    ],
  );
  await client.query(
    `INSERT INTO enquiry_events(dealer_id,enquiry_id,vehicle_id,vehicle_title,vehicle_url,kind,actor,summary,detail,occurred_at)
    SELECT $1,$2::uuid,(SELECT id FROM vehicles WHERE id=$3::uuid AND dealer_id=$1),$4,$5,'enquiry_received','customer','Website chat enquiry received',$6::jsonb,$7
    WHERE NOT EXISTS(SELECT 1 FROM enquiry_events WHERE dealer_id=$1 AND enquiry_id=$2::uuid AND kind='enquiry_received')`,
    [
      dealerId,
      input.id,
      car?.id ?? null,
      car?.title ?? null,
      car?.url ?? null,
      JSON.stringify({ source: "chat", reference: input.reference }),
      input.createdAt,
    ],
  );
}
/** Staff history reads only deliberately selected public conversation fields, never session secrets. */
export async function readDealerChatRecords(
  dealerId: string,
  database: ChatQueryClient,
) {
  try {
    const state = (
      await database.query("SELECT state FROM dealer_chat WHERE dealer_id=$1", [
        dealerId,
      ])
    ).rows[0]?.state as ChatState | undefined;
    return (state?.records ?? []).map((record) => ({
      conversation: record.conversation,
      messages: record.messages,
    }));
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") return [];
    throw error;
  }
}
