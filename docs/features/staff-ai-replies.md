# Staff-reviewed AI replies

The first rollout is for email and enquiry reply suggestions in the staff portal. Website chat, incoming email, automatic generation and automatic sending are separate features and remain off.

## Staff workflow

1. Open a customer enquiry, then **Prepare reply**.
2. Choose **Draft with AI**. Read the explanation of what is sent to OpenAI, then choose **Generate draft**.
3. Review the separate suggestion and its warnings. Existing email text remains intact until **Use this draft** is chosen. If the email changed meanwhile, replacement requires another explicit choice.
4. Edit the text if needed and select the usual attachments. AI does not select attachments, change recipients, send emails or change a booking.
5. Save the draft or use **Review email**, then the existing explicit send confirmation. Applying a suggestion alone neither saves nor sends it.

Generation uses a server-side OpenAI connection and a small set of current, dealer-scoped enquiry, vehicle and business facts. Customer contact fields, invoices, service-book photographs, other attachments and integration credentials are excluded. An enquiry message can itself contain personal information; staff see a disclosure before requesting generation. Instructions inside an enquiry are untrusted content, not authority to change the system or call tools.

Suggestions require staff checking. They must not be treated as proof of finance approval, road-tax or insurance cost, warranty coverage, ULEZ compliance, vehicle condition or an appointment confirmation. Current enquiry, vehicle and dealership facts are checked again after generation, when saving, when reviewing and immediately before sending. An expired suggestion or changed facts require a fresh suggestion or a new template. Provenance survives ordinary edits and reopening the draft; switching to a template clears it.

## Operator setup in Render

Use the existing `luxxy-shared-staging` service, not a new service or a separate account per dealer.

1. Create a project for this application in the [OpenAI API dashboard](https://platform.openai.com/), arrange API billing and create an application API key. API usage is billed separately from a ChatGPT subscription.
2. Open [the Render service](https://dashboard.render.com/web/srv-db4jfhk9v7es73a4qhrg), then its **Environment** settings.
3. Enter the key yourself as `OPENAI_API_KEY`. Do not paste it in chat, commit it, place it in website settings or prefix it with `VITE_`.
4. For the initial Luxxy pilot only, set `AI_DRAFTS_ENABLED=true` and `AI_DRAFTS_DEALER_IDS=luxxy-motors`.
5. Save the environment changes and deploy/restart using Render's normal flow. The release must include migration `0039`; the existing pre-deploy migration command applies it before the service starts.
6. First test with a fictional enquiry. Generate, review and save a suggestion without sending it. Check another dealership remains disabled. Verify edited text and attachments survive retries and stale changes are refused.

No API key is returned by configuration endpoints. Removing the allowlist entry or setting `AI_DRAFTS_ENABLED=false` disables generation; manual drafts and normal email remain usable. Adding a dealer ID deliberately opts that dealership in to using the platform's API key, with separate usage accounting.

## Initial controls

- Fixed `gpt-6-luna` model through the Responses API; no automatic fallback, web search, external tools or file uploads.
- Staff-requested generation only: opening an enquiry or refreshing Notifications does not make a paid request.
- Initial limits: 20 generations per London calendar day, 500 per London calendar month per dealer, plus conservative $2/dealer/month and $10/platform/month application spending guards.
- Bounded input and output, request timeouts, durable request IDs and reservations before a paid request. An identical retry does not start another generation. Failed or uncertain requests retain reservations rather than assuming a provider did no work.
- Generation does not overwrite another staff member's draft. Dealer, enquiry revision, draft version and current facts are checked before and after generation, when saving, when reviewing and before sending. Suggestion text expires after 24 hours; a lazy cleanup removes expired or deleted-case result text without removing spending records.
- Local preview always reports AI unavailable and never contacts OpenAI, even if a real key is accidentally present in the shell environment.

These application guards are conservative estimates, not the provider's final invoice. Review current OpenAI pricing before changing the model, processing tier or reservation rates.

`store:false` is requested for Responses. This is not a promise of zero provider retention: OpenAI's abuse-monitoring and other applicable retention policies still apply unless the account has separately approved controls.

## Official references

- [API authentication and server-side key handling](https://developers.openai.com/api/reference/overview)
- [GPT-6 Luna capabilities and pricing](https://developers.openai.com/api/docs/models/gpt-6-luna)
- [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [API data controls](https://developers.openai.com/api/docs/guides/your-data)
- [ChatGPT subscription and API pricing](https://learn.chatgpt.com/docs/pricing)
