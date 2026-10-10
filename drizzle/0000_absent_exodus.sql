CREATE TABLE "audit_logs" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"order_id" varchar(64),
	"incident_id" varchar(64),
	"action" varchar(64) NOT NULL,
	"actor" varchar(64) NOT NULL,
	"details" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "entitlements" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"order_id" varchar(64) NOT NULL,
	"customer_id" varchar(64) NOT NULL,
	"plan_id" varchar(64) NOT NULL,
	"source_reference" varchar(128) NOT NULL,
	"status" varchar(32) DEFAULT 'ACTIVE' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlements_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "entitlements_source_reference_unique" UNIQUE("source_reference")
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"order_id" varchar(64) NOT NULL,
	"payment_reference" varchar(128) NOT NULL,
	"customer_id" varchar(64) NOT NULL,
	"status" varchar(32) DEFAULT 'OPEN' NOT NULL,
	"reason" varchar(64) NOT NULL,
	"fencing_token" integer DEFAULT 0 NOT NULL,
	"lease_owner" varchar(128),
	"lease_expires_at" timestamp with time zone,
	"error_detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incidents_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"customer_id" varchar(64) NOT NULL,
	"plan_id" varchar(64) NOT NULL,
	"payment_reference" varchar(128) NOT NULL,
	"expected_amount" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'NGN' NOT NULL,
	"status" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"paystack_access_code" varchar(128),
	"paystack_authorization_url" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_payment_reference_unique" UNIQUE("payment_reference")
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"order_id" varchar(64),
	"payment_reference" varchar(128) NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"status" varchar(32) NOT NULL,
	"amount" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"customer_email" varchar(255) NOT NULL,
	"channel" varchar(32),
	"gateway_response" text,
	"payload_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_plans" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"description" text,
	"amount" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'NGN' NOT NULL,
	"duration_days" integer DEFAULT 30 NOT NULL,
	"is_active" varchar(16) DEFAULT 'true' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_checks" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"component" varchar(64) NOT NULL,
	"status" varchar(32) NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_payment_reference_orders_payment_reference_fk" FOREIGN KEY ("payment_reference") REFERENCES "public"."orders"("payment_reference") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_status_created_idx" ON "orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_ref_event_idx" ON "payment_events" USING btree ("payment_reference","event_type");