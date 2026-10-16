export type ChecklistEntry = { status: 'pending' | 'done' | 'skipped'; note: string; updatedAt: string; updatedBy: string };
export const onboardingGroups: { title: string; items: { id: string; label: string }[] }[] = [
  {
    "title": "Business and owner",
    "items": [
      {
        "id": "business",
        "label": "Business details, pricing and source permission agreed"
      },
      {
        "id": "owner_login",
        "label": "Owner and staff can sign in to the correct dealer portal"
      }
    ]
  },
  {
    "title": "Domain and website",
    "items": [
      {
        "id": "https",
        "label": "Render domain connected and HTTPS tested"
      },
      {
        "id": "aliases",
        "label": "Required domain aliases connected and verified"
      },
      {
        "id": "branding",
        "label": "Branding, contact details and website wording reviewed"
      },
      {
        "id": "booking",
        "label": "Opening hours and booking rules tested"
      },
      {
        "id": "terms",
        "label": "Business policies, sale terms and invoice references approved"
      }
    ]
  },
  {
    "title": "Stock connection",
    "items": [
      {
        "id": "worker",
        "label": "Dedicated Grok bot and secure credential configured"
      },
      {
        "id": "import_retry",
        "label": "Controlled import and identical retry verified without duplicates"
      },
      {
        "id": "isolation",
        "label": "Stock count and dealer separation checked"
      },
      {
        "id": "stock_safety",
        "label": "Incomplete imports and reserved/sold-state safeguards tested"
      },
      {
        "id": "morning",
        "label": "First scheduled morning import verified"
      },
      {
        "id": "evening",
        "label": "First scheduled evening import verified"
      },
      {
        "id": "alerts",
        "label": "Failure notifications reach the operator"
      }
    ]
  },
  {
    "title": "Email and payments",
    "items": [
      {
        "id": "email",
        "label": "Dealer sender domain, API key and reply-to mailbox configured"
      },
      {
        "id": "email_test",
        "label": "Test email, attachments and delivery status checked"
      },
      {
        "id": "payments",
        "label": "Optional online payment integration tested or left disabled"
      }
    ]
  },
  {
    "title": "Staff workflows",
    "items": [
      {
        "id": "enquiries",
        "label": "Customer enquiry, call logging and follow-up tested"
      },
      {
        "id": "appointments",
        "label": "Website/staff appointments and rescheduling tested"
      },
      {
        "id": "photos",
        "label": "Phone QR photo upload and customer attachments tested"
      },
      {
        "id": "invoices",
        "label": "Deposit/full invoices and payment calculations checked"
      },
      {
        "id": "availability",
        "label": "Reserve, unreserve and explicit sold action tested"
      }
    ]
  },
  {
    "title": "Launch approval",
    "items": [
      {
        "id": "backup",
        "label": "Platform backup and recovery readiness confirmed"
      },
      {
        "id": "billing",
        "label": "Billing arrangement and start date recorded"
      },
      {
        "id": "training",
        "label": "Staff walkthrough and support contacts provided"
      },
      {
        "id": "approval",
        "label": "Dealer reviewed the website and approved launch"
      }
    ]
  }
];
export const onboardingItems = onboardingGroups.flatMap(group => group.items);
