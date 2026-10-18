import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

// Opt-in, memory-only browser fixture. Never imported by the production app/API.
// No existing preview records, email provider or database is touched.
const enquiryId = "11111111-1111-4111-8111-111111111111";
const appointmentAt = "2099-10-20T10:00:00Z";
const statement =
  "Before taking this vehicle on a test drive, I confirm that:\n\n• I hold a current driving licence that permits me to drive this vehicle, and I will show it to the dealership before driving.\n• I have told the dealership about any licence restrictions or information it asks for when checking whether I may drive and whether its insurance applies.\n• I am fit to drive and will follow road traffic rules and the agreed instructions.\n• I will report any collision, damage or concern promptly.\n\nThe dealership must separately check my licence and the applicable insurance before allowing the test drive. Signing does not provide insurance cover, confirm insurer approval, waive statutory rights or decide accident liability.\n\nBy typing my name I confirm that I have read this declaration.";
const rows: any[] = [];
const tokenRows = new Map<string, any>();
export async function declarationQa(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
) {
  if (process.env.DECLARATION_QA_FIXTURE !== "true") return false;
  const staff = `/api/staff/enquiries/${enquiryId}/test-drive-declarations`;
  const publicToken = /^\/api\/test-drive-declarations\/([a-f0-9]{64})$/.exec(
    url.pathname,
  )?.[1];
  const send = (data: unknown, status = 200) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(data));
    return true;
  };
  if (url.pathname === "/api/test-drive-bookings" && req.method === "GET")
    return send([
      {
        id: enquiryId,
        reference: "QA-DRIVE-001",
        vehicleId: "22222222-2222-4222-8222-222222222222",
        vehicleTitle: "2022 Ford Fiesta",
        customerName: "Alex Taylor — fictional",
        email: "alex@example.test",
        phone: "07700 900123",
        message: "Fictional browser test. No customer notifications.",
        type: "viewing",
        appointmentAt,
        appointmentStatus: "confirmed",
        appointmentRevision: 0,
        workspaceRevision: 0,
        followUpRevision: 0,
        createdAt: "2026-10-18T10:00:00Z",
        appointmentDurationMinutes: 30,
        attendance: "not_recorded",
      },
    ]);
  if (url.pathname === `/api/staff/enquiries/${enquiryId}/email-context` && req.method === 'GET') return send({ version: 0, savedDraft: null, email: 'alex@example.test', customerName: 'Alex Taylor — fictional', vehicleId: '22222222-2222-4222-8222-222222222222', vehicleTitle: '2022 Ford Fiesta', reference: 'QA-DRIVE-001', revision: 0, vehicleAvailable: true, appointmentAvailable: true, defaults: {subject: 'Your test drive',message: 'Hello Alex'}, ready: false, templates: [], invoices: [], photos: [], deliveries: [] });
  if (!url.pathname.startsWith(staff) && !publicToken) return false;
  let body: any = {};
  if (req.method === "POST") {
    let text = "";
    for await (const chunk of req) {
      text += chunk;
      if (text.length > 4096) return send({ error: "Too large" }, 413);
    }
    try {
      body = JSON.parse(text || "{}");
    } catch {
      return send({ error: "Invalid JSON" }, 400);
    }
  }
  if (url.pathname === staff && req.method === "GET")
    return send({ declarations: rows, currentAppointmentRevision: 0 });
  if (url.pathname === staff && req.method === "POST") {
    const prior = rows.find((row) => row.requestId === body.requestId);
    if (prior)
      return send({
        declaration: prior,
        url: `/test-drive-declaration/${body.token}`,
        replayed: true,
      });
    if (!/^[a-f0-9]{64}$/.test(body.token))
      return send({ error: "Invalid fixture token" }, 400);
    if (body.expectedAppointmentRevision !== 0 || body.expectedVehicleId !== "22222222-2222-4222-8222-222222222222")
      return send({ error: "The appointment changed. Refresh the booking first." }, 409);
    for (const row of rows)
      if (row.status === "pending") row.status = "revoked";
    const row = {
      id: randomUUID(),
      requestId: body.requestId,
      status: "pending",
      current: true,
      revision: 0,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 48 * 3600000).toISOString(),
      signedAt: null,
      signerName: null,
      revokedAt: null,
      statement,
      statementVersion: "browser-fixture-v1",
      statementHash: "c".repeat(64),
      snapshot: {
        dealerName: "Example Motors",
        customerName: "Alex Taylor — fictional",
        enquiryReference: "QA-DRIVE-001",
        vehicleId: "22222222-2222-4222-8222-222222222222",
        vehicle: { title: "2022 Ford Fiesta", registration: "AB22 CDE" },
        appointmentAt,
        durationMinutes: 30,
        appointmentRevision: 0,
      },
      staffChecks: {
        licenceChecked: false,
        insuranceChecked: false,
        checkedAt: null,
        checkedBy: null,
      },
    };
    rows.unshift(row);
    tokenRows.set(body.token, row);
    return send(
      {
        declaration: row,
        url: `/test-drive-declaration/${body.token}`,
        replayed: false,
      },
      201,
    );
  }
  if (publicToken) {
    const row = tokenRows.get(publicToken);
    if (!row || row.status === "revoked")
      return send(
        {
          error:
            "This declaration link is expired or withdrawn. Ask the showroom for a new link.",
        },
        410,
      );
    if (req.method === "POST") {
      if (
        body.accepted !== true ||
        body.statementHash !== row.statementHash ||
        !body.signerName?.trim()
      )
        return send({ error: "Check the declaration fields." }, 400);
      row.signedAt ??= new Date().toISOString();
      row.signerName ??= body.signerName;
      row.status = "signed";
      row.revision++;
      return send({
        status: "signed",
        signedAt: row.signedAt,
        replayed: false,
      });
    }
    return send({
      status: row.status,
      dealerName: row.snapshot.dealerName,
      vehicle: row.snapshot.vehicle,
      appointmentAt,
      durationMinutes: 30,
      statement,
      statementVersion: row.statementVersion,
      statementHash: row.statementHash,
      expiresAt: row.expiresAt,
      signedAt: row.signedAt,
    });
  }
  const row = rows.find((row) =>
    url.pathname.startsWith(`${staff}/${row.id}/`),
  );
  if (!row) return send({ error: "Declaration not found" }, 404);
  if (url.pathname.endsWith("/revoke")) {
    row.status = "revoked";
    row.revokedAt = new Date().toISOString();
    return send({ revoked: true });
  }
  if (url.pathname.endsWith("/checks")) {
    if (body.expectedRevision !== row.revision)
      return send(
        { error: "Declaration changed. Refresh before recording checks." },
        409,
      );
    row.staffChecks = {
      licenceChecked: body.licenceChecked,
      insuranceChecked: body.insuranceChecked,
      checkedAt: new Date().toISOString(),
      checkedBy: "preview-staff",
    };
    row.revision++;
    return send({ declaration: row });
  }
  return send({ error: "Fixture action unavailable" }, 405);
}
