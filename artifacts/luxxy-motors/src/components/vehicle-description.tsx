import { useId, useState } from "react";

/** Preserve the advert wording; only the phone presentation is shortened. */
export function VehicleDescription({ paragraphs }: { paragraphs: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const canCollapse = paragraphs.join(" ").length > 280;
  return <>
    <div id={id} className="vehicle-description-narrative space-y-4" data-expanded={expanded || !canCollapse}>
      {paragraphs.map((paragraph, index) => <p key={index} className="whitespace-pre-line">{paragraph}</p>)}
    </div>
    {canCollapse && <button type="button" className="vehicle-description-toggle" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>{expanded ? "Show less" : "Read full description"}</button>}
  </>;
}
