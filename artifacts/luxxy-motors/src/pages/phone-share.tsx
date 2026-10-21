import { customerWhatsAppUrl } from "@/lib/customer-whatsapp";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import "@/components/share-qr.css";
type Pack = {
  customerPhone?: string;
  title: string;
  message: string;
  expiresAt: string;
  files: { filename: string; content: string; contentType: string }[];
};
export function sharedFile(file: Pack["files"][number]) {
  const raw = atob(file.content);
  return new File(
    [Uint8Array.from(raw, (char) => char.charCodeAt(0))],
    file.filename,
    { type: file.contentType },
  );
}
export default function PhoneShare() {
  const [pack, setPack] = useState<Pack | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    document.title = "Customer sharing preview";
    const token = window.location.hash.slice(1).split("?")[0];
    const controller = new AbortController();
    if (!/^[a-f0-9]{64}$/.test(token)) {
      setError("This sharing link is incomplete. Scan a fresh QR code.");
      return;
    }
    void fetch("/api/phone-shares", {
      credentials: "omit",
      headers: { "x-phone-share-token": token },
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "This sharing link is unavailable.");
        setPack(data);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to open the sharing pack.",
          );
      });
    return () => controller.abort();
  }, []);
  async function share() {
    if (!pack) return;
    try {
      const files = pack.files.map(sharedFile);
      if (files.length && navigator.canShare?.({ files })) {
        await navigator.share({ title: pack.title, text: pack.message, files });
      } else if (navigator.share) {
        await navigator.share({
          title: pack.title,
          text: pack.message,
          url: window.location.href,
        });
      } else {
        await navigator.clipboard.writeText(
          `${pack.message}\n\n${window.location.href}`,
        );
        setNotice("Message and link copied. Paste them into your chosen app.");
        return;
      }
      setNotice("Check the chosen app to confirm whether it was sent.");
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError"))
        setError(
          "Sharing is unavailable here. Download the files or copy the message instead.",
        );
    }
  }
  function download(file: Pack["files"][number]) {
    const url = URL.createObjectURL(sharedFile(file));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  const number = new URLSearchParams(window.location.hash.split('?')[1] || '').get('wa') || pack?.customerPhone || '';
  const whatsappUrl = pack ? customerWhatsAppUrl(number, pack.message + (pack.files.length ? "\n\nView your documents and photos:\n" + window.location.href.split('?wa=')[0] : '')) : null;
  return (
    <main className="phone-share-page">
      <p>Customer sharing preview</p>
      <h1>{pack?.title || "Open your sharing pack"}</h1>
      <p>
        This link contains customer information. Check the recipient before
        forwarding it. Scanning or opening it does not send anything.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!pack && !error && <p role="status">Opening sharing pack…</p>}
      {pack && (
        <>
          <pre>{pack.message}</pre>
          <div className="phone-share-files">
            {pack.files.map((file) => (
              <article key={file.filename}>
                <strong>{file.filename}</strong>
                <br />
                <Button variant="outline" onClick={() => download(file)}>
                  Download {file.filename}
                </Button>
              </article>
            ))}
          </div>
          <div className="phone-share-actions">
            <Button onClick={() => void share()}>Share with customer</Button>
            <Button
              variant="outline"
              onClick={() =>
                void navigator.clipboard
                  .writeText(pack.message)
                  .then(() => setNotice("Message copied."))
                  .catch(() => setError("Copy is unavailable in this browser."))
              }
            >
              Copy message
            </Button>
            <a
              href={whatsappUrl || undefined}
              target="_blank"
              rel="noreferrer"
            >
              {whatsappUrl ? "Open WhatsApp" : "No valid customer phone number — ask staff for a new QR"}
            </a>
          </div>
          <p>
            Link expires {new Date(pack.expiresAt).toLocaleString("en-GB")}. The
            dealership can revoke it sooner.
          </p>
        </>
      )}
    </main>
  );
}
