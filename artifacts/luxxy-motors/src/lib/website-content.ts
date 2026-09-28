import type { DealerConfig } from "@/config/dealer";

export const websiteFields = [
  {
    "key": "navigationStock",
    "label": "Navigation stock",
    "group": "Navigation",
    "defaultValue": "Browse Stock"
  },
  {
    "key": "navigationContact",
    "label": "Navigation contact",
    "group": "Navigation",
    "defaultValue": "Contact us"
  },
  {
    "key": "navigationPartExchange",
    "label": "Navigation part exchange",
    "group": "Navigation",
    "defaultValue": "Part Ex"
  },
  {
    "key": "stockTitle",
    "label": "Stock title",
    "group": "Browse stock",
    "defaultValue": "Browse Stock"
  },
  {
    "key": "stockIntroduction",
    "label": "Stock introduction",
    "group": "Browse stock",
    "defaultValue": "Find your next used car."
  },
  {
    "key": "servicesEyebrow",
    "label": "Services eyebrow",
    "group": "Homepage",
    "defaultValue": "Along the way"
  },
  {
    "key": "servicesHeading",
    "label": "Services heading",
    "group": "Homepage",
    "defaultValue": "The details, taken care of."
  },
  {
    "key": "featuredHeading",
    "label": "Featured heading",
    "group": "Homepage",
    "defaultValue": "Featured cars"
  },
  {
    "key": "visitHeading",
    "label": "Visit heading",
    "group": "Homepage",
    "defaultValue": "Plan your visit"
  },
  {
    "key": "teamHeading",
    "label": "Team heading",
    "group": "Homepage",
    "defaultValue": "Meet the team"
  },
  {
    "key": "reviewsHeading",
    "label": "Reviews heading",
    "group": "Homepage",
    "defaultValue": "What our customers say"
  },
  {
    "key": "contactTitle",
    "label": "Contact title",
    "group": "Contact",
    "defaultValue": "Contact us."
  },
  {
    "key": "contactIntroduction",
    "label": "Contact introduction",
    "group": "Contact",
    "defaultValue": "A question about a car, a part exchange or a visit? Speak to the team, send a message or arrange a time to see us."
  },
  {
    "key": "contactTalkHeading",
    "label": "Contact talk heading",
    "group": "Contact",
    "defaultValue": "Talk to the showroom"
  },
  {
    "key": "contactVisitHeading",
    "label": "Contact visit heading",
    "group": "Contact",
    "defaultValue": "Come and see the car."
  },
  {
    "key": "contactVisitDescription",
    "label": "Contact visit description",
    "group": "Contact",
    "defaultValue": "Choose the car you\u2019re interested in and book a test drive. We\u2019ll confirm the details so you can plan your visit."
  },
  {
    "key": "contactDirectionsHeading",
    "label": "Contact directions heading",
    "group": "Contact",
    "defaultValue": "How to find us"
  },
  {
    "key": "contactBeforeHeading",
    "label": "Contact before heading",
    "group": "Contact",
    "defaultValue": "Before you set off"
  },
  {
    "key": "contactParkingHeading",
    "label": "Contact parking heading",
    "group": "Contact",
    "defaultValue": "Parking & arrival"
  },
  {
    "key": "contactMessageHeading",
    "label": "Contact message heading",
    "group": "Contact",
    "defaultValue": "What would you like to know?"
  },
  {
    "key": "contactMessageDescription",
    "label": "Contact message description",
    "group": "Contact",
    "defaultValue": "Tell us which car you\u2019re considering, ask about a part exchange, or leave a question for the team."
  },
  {
    "key": "warrantyEyebrow",
    "label": "Warranty eyebrow",
    "group": "Warranty",
    "defaultValue": "Owning your next car"
  },
  {
    "key": "warrantySupportingCopy",
    "label": "Warranty supporting copy",
    "group": "Warranty",
    "defaultValue": "Know the cover, the cost and the conditions before you decide. Ask us for the details that apply to your chosen car."
  },
  {
    "key": "warrantyDetailsHeading",
    "label": "Warranty details heading",
    "group": "Warranty",
    "defaultValue": "The details worth checking."
  },
  {
    "key": "warrantyDetailsIntroduction",
    "label": "Warranty details introduction",
    "group": "Warranty",
    "defaultValue": "A useful warranty conversation starts with the policy wording. These are the points to confirm for the car and cover you are considering."
  },
  {
    "key": "warrantyEnquiryHeading",
    "label": "Warranty enquiry heading",
    "group": "Warranty",
    "defaultValue": "Ask about your chosen vehicle."
  },
  {
    "key": "savedEyebrow",
    "label": "Saved eyebrow",
    "group": "Saved cars",
    "defaultValue": "Your shortlist"
  },
  {
    "key": "savedTitle",
    "label": "Saved title",
    "group": "Saved cars",
    "defaultValue": "Saved cars"
  },
  {
    "key": "savedDescription",
    "label": "Saved description",
    "group": "Saved cars",
    "defaultValue": "Kept on this device. Pick up where you left off with your favourites."
  },
  {
    "key": "compareTitle",
    "label": "Compare title",
    "group": "Comparison",
    "defaultValue": "Compare cars"
  },
  {
    "key": "compareDescription",
    "label": "Compare description",
    "group": "Comparison",
    "defaultValue": "Price, specification and running details at a glance."
  },
  {
    "key": "viewingTitle",
    "label": "Viewing title",
    "group": "Enquiry pages",
    "defaultValue": "Book a test drive"
  },
  {
    "key": "viewingDescription",
    "label": "Viewing description",
    "group": "Enquiry pages",
    "defaultValue": "Choose a date and time to see the car and ask the team any questions."
  },
  {
    "key": "generalTitle",
    "label": "General title",
    "group": "Enquiry pages",
    "defaultValue": "How can we help?"
  },
  {
    "key": "generalDescription",
    "label": "General description",
    "group": "Enquiry pages",
    "defaultValue": "A direct line to the team behind the showroom. We will come back to you with a useful answer."
  },
  {
    "key": "deliveryTitle",
    "label": "Delivery title",
    "group": "Enquiry pages",
    "defaultValue": "Arrange delivery"
  },
  {
    "key": "deliveryDescription",
    "label": "Delivery description",
    "group": "Enquiry pages",
    "defaultValue": "Tell us your location and the car you are interested in. We will confirm delivery options and costs."
  },
  {
    "key": "warrantyTitle",
    "label": "Warranty title",
    "group": "Enquiry pages",
    "defaultValue": "Warranty enquiries"
  },
  {
    "key": "warrantyDescription",
    "label": "Warranty description",
    "group": "Enquiry pages",
    "defaultValue": "We will talk you through the warranty options available for the vehicle you have in mind."
  },
  {
    "key": "part_exchangeTitle",
    "label": "Part-exchange title",
    "group": "Enquiry pages",
    "defaultValue": "Part-exchange your car"
  },
  {
    "key": "part_exchangeDescription",
    "label": "Part-exchange description",
    "group": "Enquiry pages",
    "defaultValue": "Tell us about your car. Choose your next one. Choose how to send your details."
  },
  {"key": "vehicleSpecificationHeading", "label": "Specification heading", "group": "Vehicle page", "defaultValue": "Vehicle specification"},
  {"key": "vehicleDescriptionHeading", "label": "Description heading", "group": "Vehicle page", "defaultValue": "About this vehicle"},
  {"key": "vehicleInformationHeading", "label": "Buyer information heading", "group": "Vehicle page", "defaultValue": "What to know about this car"},
  {"key": "vehicleFeaturesHeading", "label": "Features heading", "group": "Vehicle page", "defaultValue": "Features & equipment"},
  {"key": "vehicleSimilarHeading", "label": "Similar cars heading", "group": "Vehicle page", "defaultValue": "You may also like"},
] as const;

export type WebsiteTextKey = typeof websiteFields[number]["key"];
export function websiteText(settings: Pick<DealerConfig, "presentation">, key: WebsiteTextKey): string {
  return settings.presentation?.websiteCopy?.[key]?.trim() || websiteFields.find(field => field.key === key)!.defaultValue;
}
