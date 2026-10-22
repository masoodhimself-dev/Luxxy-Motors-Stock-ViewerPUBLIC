// Read-only video examples and fictional sharing packs for local visual QA only.
// Production never imports this preview module.
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const { jsPDF } = createRequire(
  new URL("../../api-server/package.json", import.meta.url),
)("jspdf");
import { previewStock } from "./stock";
import { videoRange } from "../../api-server/src/lib/media-storage";
import { readPreviewEnquiries } from './reservations';
import { renderWhatsAppTemplate, validateWhatsAppMessage, whatsappTemplateIds, type WhatsAppTemplateId } from '@workspace/vehicle-meta';
import { previewIntegrationsStore } from './dealer-integrations';
const packs = new Map<string, { id: string; expiresAt: string; message: string; messageBody: string; requiredText: string; templateId: WhatsAppTemplateId; templateVariables: Record<string, string>; messageLinkRequired: boolean; hasAttachments: boolean }>();
const demoId = "00000000-0000-4000-8000-000000000048";
export async function mediaSharingPreview(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
) {
  const match =
    /^\/api\/(?:staff\/inventory\/([^/]+)\/videos(?:\/.*)?|vehicles\/([^/]+)\/video(?:\/(media))?|staff\/phone-shares(?:\/([^/]+)\/revoke)?|staff\/phone-shares\/(?:enquiries|confirm-whatsapp|email-enquiry)|phone-shares)$/.exec(
      url.pathname,
    );
  if (!match) return false;
  const send = (status: number, body: unknown) => {
    res.statusCode = status;
    res.end(JSON.stringify(body));
    return true;
  };
  const remote = (req.socket.remoteAddress || "").replace(/^::ffff:/, "");
  if (
    !["127.0.0.1", "::1"].includes(remote) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(
      new URL(`http://${req.headers.host}`).hostname,
    )
  )
    return send(403, { error: "Media examples are loopback-only." });
  const enabled = process.env.MEDIA_SHARING_PREVIEW === "true";
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  if (match[1] || match[2]) {
    const car = previewStock.cars.find(
      (car) => car.id === (match[1] || match[2]),
    );
    if (!car) return send(404, { error: "Car not found." });
    const media = `/api/vehicles/${car.id}/video/media`,
      shareUrl = `http://${req.headers.host}/vehicle/${car.id}?video=1#walkaround`;
    if (match[3]) {
      if (!enabled || !process.env.VIDEO_PREVIEW_FILE)
        return send(404, { error: "No sample video configured." });
      const bytes = await readFile(process.env.VIDEO_PREVIEW_FILE);
      if (bytes.length > 5 * 1024 * 1024)
        return send(413, { error: "Example file too large." });
      let range;
      try {
        range = videoRange(req.headers.range, bytes.length);
      } catch {
        res.statusCode = 416;
        res.end();
        return true;
      }
      res.statusCode = range ? 206 : 200;
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Accept-Ranges", "bytes");
      if (range)
        res.setHeader(
          "Content-Range",
          `bytes ${range.start}-${range.end}/${bytes.length}`,
        );
      const data = range ? bytes.subarray(range.start, range.end + 1) : bytes;
      res.setHeader("Content-Length", data.length);
      res.end(req.method === "HEAD" ? undefined : data);
      return true;
    }
    if (req.method !== "GET")
      return send(409, {
        error:
          "This local example is read-only. Real uploads and publishing require the authenticated server.",
      });
    if (match[1])
      return send(200, {
        enabled: false,
        preview: true,
        shareUrl,
        videos: enabled
          ? [
              {
                id: demoId,
                status: "ready",
                published: true,
                revision: 1,
                durationMs: 2000,
                byteSize: 120000,
                previewUrl: media,
              },
              {
                id: "00000000-0000-4000-8000-000000000049",
                status: "ready",
                published: false,
                revision: 1,
                durationMs: 2000,
                byteSize: 120000,
                previewUrl: media,
              },
            ]
          : [],
      });
    return send(200, {
      video: enabled ? { url: media, shareUrl, preview: true } : null,
    });
  }
  if (!enabled)
    return send(409, {
      error:
        "Private QR packs require the authenticated server. Nothing was sent.",
    });
  if (url.pathname === "/api/staff/phone-shares/enquiries" && req.method === "GET") {
    const id=url.searchParams.get('id'),query=(url.searchParams.get('q')||'').toLowerCase();
    const entries=(await readPreviewEnquiries()).filter(entry=>!entry.mergedIntoId&&(id?entry.id===id:[entry.customerName,entry.phone,entry.email].join(' ').toLowerCase().includes(query))).slice(0,20);
    return send(200,{enquiries:entries.map(entry=>({id:entry.id,customerName:entry.customerName,phone:entry.phone,email:entry.email,vehicleTitle:entry.vehicleTitle})),canCreate:false});
  }
  if (url.pathname === "/api/staff/phone-shares/email-enquiry" && req.method === "POST") {
    let body='';for await(const part of req){body+=String(part);if(body.length>32768)return send(413,{error:'Request too large.'});}
    try {
      const data=JSON.parse(body),entry=(await readPreviewEnquiries()).find(entry=>entry.id===data.enquiryId&&!entry.mergedIntoId);
      if(!entry)return send(409,{error:'Save a fictional customer in Quick enquiry first, then select that enquiry for this local review.'});
      if(data.grantId&&![...packs.values()].some(pack=>pack.id===data.grantId&&Date.parse(pack.expiresAt)>Date.now()))return send(410,{error:'This sharing link has expired. Create a new one.'});
      return send(200,{enquiry:{id:entry.id,customerName:entry.customerName,reference:entry.reference},customerEmail:data.email||entry.email||''});
    }catch{return send(400,{error:'Invalid preview request.'});}
  }
  if (url.pathname === "/api/staff/phone-shares/confirm-whatsapp" && req.method === "POST") {
    let body=""; for await (const part of req) {body+=String(part);if(body.length>65536)return send(413,{error:"Preview request too large."});}
    try {const data=JSON.parse(body);if(data.confirmed!==true)return send(400,{error:"Confirm the message was sent."});return send(201,{enquiryId:data.enquiryId||demoId,confirmedAt:new Date().toISOString(),preview:true});}catch{return send(400,{error:"Invalid preview request."});}
  }
  if (url.pathname === "/api/staff/phone-shares" && req.method === "POST") {
    let body = "";
    for await (const part of req) {
      body += String(part);
      if (body.length > 32768)
        return send(413, { error: "Request too large." });
    }
    let data: any;
    try {
      data = JSON.parse(body);
    } catch {
      return send(400, { error: "Invalid request." });
    }
    if (!/^[a-f0-9]{64}$/.test(data.token || ""))
      return send(400, { error: "Invalid preview token." });
    const templateId: WhatsAppTemplateId = (whatsappTemplateIds as readonly string[]).includes(data.templateId) ? data.templateId : 'invoice';
    const templateVariables = { customer_name: 'Fictional customer', dealer_name: 'Local preview showroom', vehicle_title: 'Fictional preview car', vehicle_registration: 'AB12CDE', appointment_time: 'Friday at 10:00 (UK time)', message: 'Local visual test only. This is not a real invoice or customer message.' };
    let messageBody: string;
    try {
      const template = (await previewIntegrationsStore.listWhatsAppTemplates()).templates.find(item => item.id === templateId)!;
      messageBody = data.messageBody !== undefined ? validateWhatsAppMessage(data.messageBody) : data.templateId ? renderWhatsAppTemplate(template, templateVariables) : templateVariables.message;
    } catch (error) { return send(400, {error: error instanceof Error ? error.message : 'Check the message.'}); }
    const requiredText = data.source?.kind === 'message' ? data.source.url || 'FICTIONAL LOCAL PREVIEW ONLY' : 'FICTIONAL LOCAL PREVIEW ONLY\nVehicle: Fictional preview car\nAttachment: fictional-invoice.pdf';
    const saved = packs.get(data.token) || {
      id: randomUUID(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      messageBody, requiredText, templateId, templateVariables,
      messageLinkRequired: data.source?.kind === 'message', hasAttachments: data.source?.kind !== 'message',
      message: [messageBody, requiredText].join('\n\n'),
    };
    packs.set(data.token, saved);
    return send(201, {
      ...saved,
      customerPhone: "07700 900123",
      url: `http://${req.headers.host}/phone-share#${data.token}`,
      preview: true,
    });
  }
  if (match[4] && req.method === "POST") {
    for (const [token, pack] of packs)
      if (pack.id === match[4]) packs.delete(token);
    return send(200, { revoked: true });
  }
  if (url.pathname === "/api/phone-shares" && req.method === "GET") {
    const token = String(req.headers["x-phone-share-token"] || ""),
      pack = packs.get(token);
    if (!pack)
      return send(404, {
        error: "This fictional preview link is unavailable.",
      });
    const pdf = new jsPDF();
    pdf.text("FICTIONAL LOCAL SHARING EXAMPLE", 18, 24);
    pdf.text("No real customer document or email was used.", 18, 40);
    return send(200, {
      customerPhone: "07700 900123",
      title: "Fictional invoice sharing example",
      message: pack.message,
      expiresAt: pack.expiresAt,
      files: pack.hasAttachments ? [
        {
          filename: "fictional-invoice.pdf",
          content: Buffer.from(pdf.output("arraybuffer")).toString("base64"),
          contentType: "application/pdf",
        },
      ] : [],
    });
  }
  return send(404, { error: "Not found." });
}
