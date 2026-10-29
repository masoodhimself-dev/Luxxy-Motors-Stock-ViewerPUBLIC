import { EnquiryTextChecks } from "./enquiry-text-checks";
/** Only condense the website's known part-exchange format; never rewrite customer text. */
export function partExchangeMessageParts(text: string) {
  const match = text.match(/^([\s\S]+?)\n\s*MY CURRENT CAR\n([\s\S]+?)\n\s*YOUR STOCK VEHICLE\n([\s\S]+?)\n\s*MY CONTACT DETAILS\n([\s\S]+)$/);
  if (!match) return null;
  return { introduction: match[1].trim(), car: match[2].trim(), contact: match[4].trim() };
}

export function EnquiryOriginalMessage({ text }: { text: string }) {
  const parts = partExchangeMessageParts(text);
  if (!parts) return <p className="enquiry-history-copy"><EnquiryTextChecks text={text} /></p>;
  // The customer and stock car already have their own panels. Keep unrecognised
  // lines and all notes visible, with the unchanged source available on demand.
  const otherContactText = parts.contact.split('\n').filter(line => !/^(Name|Phone|Email):/.test(line)).join('\n').trim();
  return <div className="enquiry-original-summary">
    <p className="enquiry-history-copy"><EnquiryTextChecks text={parts.introduction} /></p>
    <section className="enquiry-exchange-summary" aria-label="Customer's part-exchange car">
      <h5>Customer’s part-exchange car</h5>
      <dl>{parts.car.split('\n').map((line, index) => {
        const colon = line.indexOf(':');
        return colon > 0 ? <div key={index}><dt>{line.slice(0, colon)}</dt><dd><EnquiryTextChecks text={line.slice(colon + 1).trim()} /></dd></div> : <div key={index} className="enquiry-exchange-note"><dd><EnquiryTextChecks text={line} /></dd></div>;
      })}</dl>
    </section>
    {otherContactText && <p className="enquiry-history-copy enquiry-exchange-extra"><EnquiryTextChecks text={otherContactText} /></p>}
    <details className="conversation-original"><summary>View full original enquiry</summary><p className="enquiry-history-copy"><EnquiryTextChecks text={text} /></p></details>
  </div>;
}
