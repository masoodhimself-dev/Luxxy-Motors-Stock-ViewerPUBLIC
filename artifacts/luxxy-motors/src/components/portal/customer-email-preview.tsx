import { useMemo, useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import "./customer-email-preview.css";

/** Keep the server-rendered email design, while making the preview non-interactive. */
export function emailPreviewDocument(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc
    .querySelectorAll("script, iframe, object, embed, base, link")
    .forEach((node) => node.remove());
  doc.querySelectorAll("meta[http-equiv]").forEach((node) => {
    if (node.getAttribute("http-equiv")?.toLowerCase().trim() === "refresh")
      node.remove();
  });
  doc.querySelectorAll("a, area").forEach((node) => {
    ["href", "xlink:href", "target", "download", "ping"].forEach((attribute) =>
      node.removeAttribute(attribute),
    );
    node.setAttribute("inert", "");
    node.setAttribute("tabindex", "-1");
    node.setAttribute("aria-disabled", "true");
  });
  doc
    .querySelectorAll("form, button, input, select, textarea")
    .forEach((node) => {
      node.setAttribute("inert", "");
      node.setAttribute("tabindex", "-1");
      node.setAttribute("disabled", "");
      node.removeAttribute("action");
      node.removeAttribute("formaction");
    });
  const policy = doc.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  const localImages =
    /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(
      window.location.origin,
    )
      ? ` ${window.location.origin}`
      : "";
  policy.content = `default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src https: data:${localImages}; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  doc.head.prepend(policy);
  const detection = doc.createElement("meta");
  detection.name = "format-detection";
  detection.content = "telephone=no,email=no,address=no,date=no,url=no";
  const interactions = doc.createElement("style");
  interactions.textContent =
    "a,area,form,button,input,select,textarea{pointer-events:none!important}";
  doc.head.append(detection, interactions);
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

export function CustomerEmailPreview({
  html,
  text,
}: {
  html?: string;
  text: string;
}) {
  const [format, setFormat] = useState<"design" | "text">(
    html ? "design" : "text",
  );
  const [width, setWidth] = useState<"desktop" | "phone">("desktop");
  const document = useMemo(
    () => (html ? emailPreviewDocument(html) : ""),
    [html],
  );
  const showDesign = Boolean(document && format === "design");
  return (
    <section
      className="customer-email-preview"
      aria-label="Customer email preview"
    >
      <div className="customer-email-preview-toolbar">
        <div
          className="customer-email-preview-formats"
          role="group"
          aria-label="Email preview format"
        >
          <button
            type="button"
            disabled={!html}
            aria-pressed={showDesign}
            onClick={() => setFormat("design")}
          >
            Design
          </button>
          <button
            type="button"
            aria-pressed={!showDesign}
            onClick={() => setFormat("text")}
          >
            Plain text
          </button>
        </div>
        {showDesign && (
          <div
            className="customer-email-preview-widths"
            role="group"
            aria-label="Email preview width"
          >
            <button
              type="button"
              aria-label="Desktop preview"
              title="Desktop preview"
              aria-pressed={width === "desktop"}
              onClick={() => setWidth("desktop")}
            >
              <Monitor size={17} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Phone preview"
              title="Phone preview"
              aria-pressed={width === "phone"}
              onClick={() => setWidth("phone")}
            >
              <Smartphone size={17} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      {showDesign ? (
        <>
          <div
            className={`customer-email-preview-canvas ${width === "phone" ? "is-phone" : ""}`}
          >
            <iframe
              title="Customer email design preview"
              sandbox=""
              referrerPolicy="no-referrer"
              srcDoc={document}
            />
          </div>
          <p className="customer-email-preview-note">
            Preview links are disabled. Nothing has been sent.
          </p>
        </>
      ) : (
        <>
          {!html && (
            <p className="customer-email-preview-note">
              Plain-text preview. Reopen the email to load the latest design
              preview.
            </p>
          )}
          <div className="customer-email-preview-text">{text}</div>
        </>
      )}
    </section>
  );
}
