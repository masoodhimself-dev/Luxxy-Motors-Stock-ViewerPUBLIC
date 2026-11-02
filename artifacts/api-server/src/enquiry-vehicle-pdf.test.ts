import test from "node:test";
import assert from "node:assert/strict";
import { createEnquiryVehiclePdf, enquiryVehiclePdfMaximumBytes } from "./lib/enquiry-vehicle-pdf";
import { draftSchema } from "./routes/enquiry-emails";

const car = { id: "fictional-car", title: "Audi A5", make: "Audi", model: "A5", plate: "AB12 CDE", price: 5490, year: 2013, images: Array.from({ length: 12 }, (_, index) => ({ url: `https://m.atcdn.co.uk/${index}.jpg` })) };

test("attached vehicle PDFs are reproducible, compact, named safely and change with current stock or dealership facts", async () => {
  let price = car.price, includedItems = ["6 months warranty"];
  const loads: number[] = [];
  const generate = createEnquiryVehiclePdf({
    findVehicle: async () => ({ ...car, price }),
    readDealer: async () => ({ name: "Example Motors", includedItems }),
    loadPhotos: async photos => { loads.push(photos.length); return photos; },
  });
  const first = await generate(car.id, "https://example.test");
  const second = await generate(car.id, "https://example.test");
  assert.equal(first.content, second.content, "unchanged facts create exactly the reviewed PDF bytes");
  assert.equal(Buffer.from(first.content, "base64").subarray(0, 5).toString(), "%PDF-");
  assert.match(first.filename, /^[a-zA-Z0-9-]+\.pdf$/);
  assert.equal(first.id, `vehicle-pdf:${car.id}`);
  assert.ok(loads.every(count => count <= 4));
  price = 5250;
  const repriced = await generate(car.id, "https://example.test");
  assert.notEqual(repriced.content, first.content);
  includedItems = ["3 months warranty"];
  assert.notEqual((await generate(car.id, "https://example.test")).content, repriced.content);
});

test("unavailable, mismatched, invalid or oversized PDFs fail before an attachment is returned", async () => {
  const make = (extra: Partial<Parameters<typeof createEnquiryVehiclePdf>[0]> = {}) => createEnquiryVehiclePdf({ findVehicle: async () => car, readDealer: async () => ({ name: "Example" }), loadPhotos: async photos => photos, ...extra });
  await assert.rejects(make({ findVehicle: async () => null })(car.id, "https://example.test"), /unavailable/i);
  await assert.rejects(make({ findVehicle: async () => ({ ...car, id: "another-dealer-car" }) })(car.id, "https://example.test"), /unavailable/i);
  await assert.rejects(make({ render: () => { throw new Error("Renderer unavailable"); } })(car.id, "https://example.test"), /could not be prepared/i);
  await assert.rejects(make({ render: () => Buffer.from("not a PDF") })(car.id, "https://example.test"), /could not be prepared/i);
  await assert.rejects(make({ render: () => Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(enquiryVehiclePdfMaximumBytes)]) })(car.id, "https://example.test"), /too large/i);
});

test("older email drafts remain PDF-free while an explicit attachment choice is validated", () => {
  const content = { to: "buyer@example.test", subject: "Your Audi", message: "Thank you", includeVehicle: false, includeAppointment: false, photoIds: [], expectedRevision: 0 };
  assert.equal(draftSchema.parse(content).attachVehiclePdf, false);
  assert.equal(draftSchema.parse({ ...content, attachVehiclePdf: true }).attachVehiclePdf, true);
  assert.equal(draftSchema.safeParse({ ...content, attachVehiclePdf: "true" }).success, false);
});
