# Email and enquiry interface audit — 23 October 2026

## Scope and method

Inspected the signed-in Shore Drive production portal in the browser, with source review to explain behaviour. Rendered desktop (1280 × 800 CSS pixels), tablet (834 × 1112) and phone (390 × 844) layouts were inspected. Browser viewport emulation is not a physical iPhone, iPad or Android test.

Reviewed Conversations, empty Drafts to review, scoped enquiry detail, queue/filter controls, reply composer, follow-up dialog, customer-history matching dialog, Quick Enquiry search and selected-car state, and the existing booking entry from an enquiry. No emails/WhatsApp messages were sent, enquiry/appointment/customer records saved, settings changed, code changed or deployment performed. Opening the existing booking entry populated its browser-local autosaved form; no booking was submitted. Existing saved email drafts were left untouched. Marketplace importing remains outside scope and paused.

## Conclusion

The main problem is fragmented presentation: staff move between Email, Customers & enquiries and multiple histories to understand one conversation. Simplify to one Inbox with a customer/enquiry conversation and one obvious next action. Preserve distinct enquiries, identity checks, permissions, sending approval and all booking/sales rules.

## Findings

| Priority | Finding and evidence | Recommended change |
| --- | --- | --- |
| High | Queue attention is inconsistent in code. `enquiries-panel.tsx` uses `enquiryPresentation(original)` for Needs reply, No task scheduled, counts and ordering. Pending incoming-email attention is fetched separately for selected details/Home. An information-given record can therefore retain a low-priority/no-task queue classification after a new email reply. Code-confirmed; not reproduced with a fresh unanswered live reply during this read-only audit. | Use the same attention projection for Home, list badges, filters, counts and detail. Regression-test a new reply after a previous reply was handled. |
| High | Desktop conversation content starts too low: first staff-record message was at y=647 on an 800px-high viewport. Toolbars, nested navigation, scoped-customer banner and connection banner occupy the space above it. | Compact the workspace header; remove duplicate customer banner; show connection health only when intervention is required. |
| High | Enquiry detail repeats customer identity, original request, received/preferred-contact metadata and outcome across header, request, conversation and footer. Email and enquiry views repeat the same messages in different formats. | One header, one conversation timeline and one compact next-action strip. Keep full audit metadata behind Details. |
| High | Incoming replies contain the quoted original email; outgoing bubbles include template headings and repeated subjects. Five emails made a roughly 2561px timeline in the measured desktop case. | Show clean conversational text, collapse quoted history under Show original email, and retain the original content intact. Do not irreversibly strip messages. |
| Medium | Email thread opens on early messages in the inspected case. Latest replies and Write an email are far down the thread. Desktop also has separate page/list/thread scrolling. | Open at first unanswered/latest relevant message, provide Earlier messages and a persistent reply entry. Preserve scroll position while reading older messages. |
| Medium | Open customer, Open enquiry and Customer history lead to overlapping contexts. History is also repeated in the enquiry detail and Email & saved drafts. | One Customer details drawer with clearly separated contact summary and other enquiries; one case conversation as the default. |
| Medium | Phone view switches list/detail correctly and no horizontal document overflow was measured, but repeated navigation, scope and connection information occupy most of the first screen. | Phone: list → conversation with a clear Back button, compact customer/car header and reachable Reply/Call/More actions. Do not squeeze both panes into one screen. |
| Medium | Tablet email retains two panes, leaving the conversation relatively narrow while retaining all upper banners. | Use a smaller collapsible list and one compact header. Collapse secondary customer details. Validate portrait and landscape separately. |
| Medium | Quick Enquiry successfully matched “MG HS auto white” to two cars. Once selected on phone, the large car card occupies most of the visible form, pushing customer fields below it. | Keep search first; selected car becomes a small image, model, price and Change/Details controls. Expand full details only when requested. |
| Medium | Quick Enquiry initially lists all 22 cars in the inspected dealer; repeated year/registration-year text appears in other stock selectors. | Bound the visible results with an intentional Show more; remove repeated values and use the same compact car selector everywhere. |
| Medium | Enquiry Filters & tools combines ownership, task filters, callbacks and stock navigation. Some task choices duplicate the visible queue chips. | Default filters: Needs reply, Follow-ups, All; ownership and other filters behind one Filters control. Keep appointment context accessible without duplicating navigation. |
| Medium | Email search SQL matches customer name, recipient, subject, vehicle title and reference, but not phone, registration or message body. | Define and label search coverage clearly; support the everyday lookups staff need, with safe server-side search and pagination. |
| Medium | Conversations are grouped client-side from a page of up to 50 messages, while SQL pagination is by message. Large cases may span pages or appear as partial conversation groups. Source finding; large-history behaviour not load-tested here. | Paginate conversations/cases server-side, then load messages within the selected conversation. |
| Medium | Quick Enquiry says test-drive booking is switched off, while an existing enquiry still offers Book test drive and opens the older full form. That form also did not retain the known test email in the inspected transition. | Clarify intended staff/public feature policy and carry known contact fields consistently. Do not change eligibility rules until checked against existing policy and backend validation. No booking was submitted to test enforcement. |
| Low | Empty drafts still show search and explanatory scaffolding that has no immediate use. Disabled pagination remains visible for one conversation. | Clear short empty states and conditionally show tools when useful. |
| Low | Wording such as Prepare reply, Request follow-up and provider status language makes staff interpret technical workflow. | Use Reply, Set follow-up, Add note and factual delivery labels. Never label provider acceptance as customer delivery. |

## What works and should remain

- Car-first Quick Enquiry search, including mixed make/model/colour/gearbox terms.
- Customer/enquiry context is retained when moving into Email.
- Phone list/detail navigation has explicit Back controls.
- Follow-up dialog explicitly says it creates a staff task and sends no customer message.
- Customer-history matching warns when names differ on a shared phone/email. Keep that warning and explicit record merging; do not automatically combine household members.
- Templates, review before sending, custom-photo compression and phone-upload tools remain available, but attachments should be a compact expandable part of the composer.
- Incoming replies and staff notes have different labels. Preserve this distinction.

## Proposed interface

### Inbox list

One search bar and Quick enquiry. Filters: Needs reply, Follow-ups, All; Drafts as a small count/filter. Each row shows customer, car, latest short message, time, owner and one plain-language action. Use amber for overdue, blue for reply needed, neutral for waiting/no action, green for completed work. Always include text/icon meaning; colour alone must not carry status.

### Selected enquiry/conversation

1. Compact customer header: name, phone/email access, assigned staff.
2. Small car summary: image, model, plate where known, price and Details/Change where existing rules allow.
3. One task strip, for example “Customer asked about service history — reply needed” or “Follow-up due today”. Use facts, not invented AI summaries.
4. One timeline for emails, staff-confirmed WhatsApp messages, phone notes and appointment events. Customer-facing messages visually distinct from private notes; quoted email history collapsed.
5. Reply / Call / Book test drive / More. Reply contains existing email and WhatsApp options; an in-app handoff must not imply WhatsApp delivery. Keep staff confirmation and factual history labels.
6. Secondary details drawer for earlier enquiries, full original email, delivery details and infrequent actions.

Desktop: list left, conversation right. Tablet: narrower collapsible list. Phone: one screen at a time, with sticky compact actions that do not obscure content or the keyboard.

## Implementation order and acceptance checks

1. Fix attention/count consistency before redesign. Test a new incoming reply, handled reply, staff reply, failed send and multiple incoming replies; opening a message must not silently mark it handled.
2. Remove repeated banners/metadata and unify message rendering. Compare displayed content to stored originals; original email stays accessible.
3. Consolidate navigation and histories without merging distinct customer records. Test shared phone/email and differing names.
4. Compact Quick Enquiry and composer. Test switching cars without losing customer details, attachments, email review, WhatsApp handoff and staff confirmation.
5. Add conversation-level pagination/search coverage and exercise realistic large histories.
6. Run typecheck, focused attention/history/composer tests and browser checks at phone/tablet/desktop widths. Use controlled test records for actual send/booking tests with explicit authorisation.

Suggested measurable goals: latest relevant conversation visible in the first desktop screen; reply reachable without traversing old messages; one default conversation history; no horizontal overflow at 390px; no message sending merely from opening/previewing; no changes to agreed prices, deposits, invoices or booking rules.

## Verification limits

This is an audit and proposal, not an implementation. No typechecking or automated test suite was run because no code changed. Physical devices, native keyboard behaviour, screen readers, large-history loads, new unanswered live replies, actual delivery/WhatsApp sends, booking submission and the separate full History page were not exercised in this pass. Source findings are identified separately from rendered observations. The receiving/routing release's earlier delivery tests are not counted as tests for this audit.
