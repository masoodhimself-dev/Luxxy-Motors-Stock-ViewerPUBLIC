DROP INDEX "enquiries_dealer_appointment_uidx";--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "appointment_outside_hours" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "appointment_double_booked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "appointment_over_capacity" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "enquiries_dealer_appointment_idx" ON "enquiries" USING btree ("dealer_id","appointment_at") WHERE appointment_cancelled_at is null;