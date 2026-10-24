# Shore Drive live invoice and delivery WhatsApp check

Date: 24 October 2026. Site: `https://www.shoredrive.uk`. Signed in as Masood. Tested through the actual staff portal and customer sharing page using the browser.

## Results

| Check | Result |
| --- | --- |
| Saved invoice WhatsApp preparation | Passed using existing invoice `INV-2026-00002`, Mercedes-Benz E Class, Masood Haqdad. |
| Invoice recipient | The existing `07388831790` was prefilled and the WhatsApp handoff used `447388831790`. |
| Invoice attachment | The message retained the correct PDF filename, invoice facts and temporary private document link after editing. Its customer sharing page opened with the correct invoice heading and PDF download control. The download control was clicked without a visible error; downloaded bytes were not independently inspected in this live test. |
| Invoice sent confirmation | Clicked “I’ve sent it” once with clearly labelled TEST wording stating no WhatsApp message was actually sent. Success linked to enquiry `adeda205-e6e0-4cbb-bf13-9c887db1af30`. |
| Invoice history | Opened the linked enquiry and reloaded it. Correct Masood customer/Mercedes, normalized recipient, exact test wording, invoice attachment name, timestamp and “Recorded by Masood” remained visible. |
| Delivery preparation | Created a separate draft named `TEST — WhatsApp delivery check 24 Oct`, for an available MG ZS, with the user's test contact. Saved test-only delivery arrangements for 27 October, 14:00–16:00. No payment or invoice was created. |
| Delivery recipient | `07388831790` prefilled, with `447388831790` in the ready WhatsApp handoff. |
| Delivery wording | Planned date/window, test address and recipient were included. Separate private test driver/staff-note markers were absent from the generated message. |
| Delivery customer choice | Explicitly chose a new labelled test enquiry rather than one of the other customers sharing the test phone number. QR remained unavailable until this customer choice was made. |
| Delivery sent confirmation | Clicked “I’ve sent it” once with clearly labelled TEST wording stating no WhatsApp message was sent. Saved to new enquiry `ef7b8c61-a7f8-4ef9-ac4f-389f8434452d`. |
| Delivery history | Reloaded the returned enquiry. Its test name, MG ZS, one saved conversation, normalized phone, complete message, timestamp and recorded staff name persisted. No invoice test message was placed in this enquiry. |
| Financial and stock safety | Reopened the original sale: still sold, agreed/paid £4,191, balance £0, the same two payments (£200 cash and £3,991 bank transfer), invoice `INV-2026-00002`, and original collection/to-arrange state. Reopened the test draft: no payments, no invoice, still in progress. Its car remained Available in the enquiry view. |

## Limits and retained test data

No actual WhatsApp send, email send, new official invoice, payment, real sale completion or handover was performed. This verifies the WhatsApp handoff and explicit staff-confirmed history write, not delivery through WhatsApp. The saved entries explicitly say they were tests and no message was sent. The application correctly labels confirmation as staff reported and delivery not independently verified.

Retained for inspection: one labelled test invoice-history entry on Masood's existing enquiry, one labelled delivery draft, one labelled delivery enquiry and its history entry. Private share packs have their normal expiry; private URLs/tokens are deliberately excluded from this report.

Live screenshot: `/tmp/shore-drive-delivery-whatsapp-history-2026-10-24.png`. No application code change was needed. Physical iPhone/iPad hardware was not used during this live browser test; the preceding release's automated viewport checks are documented separately.

## Test-data cleanup

Later on 24 October, the user requested removal and gave final confirmation. The single test draft, single test enquiry and two test messages above were removed, and their four temporary sharing packs were revoked. The retained real customer, issued invoices, payments, stock and all other dealership data were verified unchanged. See [the cleanup audit](shore-drive-test-cleanup-2026-10-24.md).
