ALTER TABLE "incidents" ADD COLUMN "retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "next_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "last_decision" varchar(64);--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "decision_summary" text;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "incidents_status_retry_idx" ON "incidents" USING btree ("status","next_retry_at");