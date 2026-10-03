CREATE TYPE "public"."compliance_decision" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."country_rule_action" AS ENUM('REVIEW', 'BLOCK');--> statement-breakpoint
CREATE TYPE "public"."cross_ref_type" AS ENUM('SUPERSEDED_BY', 'DOCUMENTED_CROSS_REFERENCE', 'ALTERNATIVE');--> statement-breakpoint
CREATE TYPE "public"."data_status" AS ENUM('VERIFIED', 'SUPPLIER_PROVIDED', 'ESTIMATED', 'HISTORICAL', 'PENDING_VERIFICATION');--> statement-breakpoint
CREATE TYPE "public"."export_control_status" AS ENUM('NOT_CONTROLLED', 'UNKNOWN', 'CONTROLLED');--> statement-breakpoint
CREATE TYPE "public"."identification_status" AS ENUM('EXACT', 'ITEM_TYPE', 'NEEDS_CONFIRMATION', 'NOT_IDENTIFIED');--> statement-breakpoint
CREATE TYPE "public"."item_condition" AS ENUM('NEW', 'NEW_OR_APPROVED_ALTERNATIVE', 'ANY', 'NEW_SURPLUS', 'OVERHAULED', 'SERVICEABLE', 'REPAIRED', 'AS_REMOVED');--> statement-breakpoint
CREATE TYPE "public"."org_kind" AS ENUM('BUYER', 'SUPPLIER', 'PLATFORM');--> statement-breakpoint
CREATE TYPE "public"."org_role" AS ENUM('ORG_ADMIN', 'PROCUREMENT_OFFICER', 'PROCUREMENT_MANAGER', 'FINANCE', 'COMPLIANCE_OFFICER', 'LOGISTICS', 'APPROVER', 'VIEWER');--> statement-breakpoint
CREATE TYPE "public"."price_type" AS ENUM('EXACT', 'RANGE', 'ON_REQUEST');--> statement-breakpoint
CREATE TYPE "public"."quotation_status" AS ENUM('SUBMITTED', 'SUPERSEDED', 'WITHDRAWN');--> statement-breakpoint
CREATE TYPE "public"."recipient_status" AS ENUM('SENT', 'VIEWED', 'QUOTED', 'DECLINED');--> statement-breakpoint
CREATE TYPE "public"."rfq_status" AS ENUM('DRAFT', 'COMPLIANCE_REVIEW', 'OPEN', 'QUOTED', 'CLOSED', 'CANCELLED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."supplier_type" AS ENUM('OEM', 'MANUFACTURER', 'AUTHORIZED_DISTRIBUTOR', 'STOCKIST', 'DEALER', 'MRO', 'INDUSTRIAL_SUPPLIER', 'LOGISTICS_PROVIDER', 'SOURCING_COMPANY');--> statement-breakpoint
CREATE TYPE "public"."verification_level" AS ENUM('BUSINESS_VERIFIED', 'SUPPLIER_VERIFIED', 'AUTHORIZED_DISTRIBUTOR', 'COMPLIANCE_VERIFIED');--> statement-breakpoint
CREATE TYPE "public"."verification_state" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'REVOKED');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"seq" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_logs_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"actor_user_id" uuid,
	"organization_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commercial_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"audience" "org_kind" NOT NULL,
	"components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_plans_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "compliance_country_rules" (
	"country" text PRIMARY KEY NOT NULL,
	"action" "country_rule_action" NOT NULL,
	"reason" text NOT NULL,
	"source" text NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rfq_id" uuid NOT NULL,
	"reasons" text[] NOT NULL,
	"decision" "compliance_decision" DEFAULT 'PENDING' NOT NULL,
	"reviewer_user_id" uuid,
	"notes" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"anon_token_hash" text,
	"state" jsonb NOT NULL,
	"rfq_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_org_id" uuid,
	"uploaded_by_user_id" uuid,
	"conversation_id" uuid,
	"rfq_id" uuid,
	"quotation_id" uuid,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "inventory_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_org_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"condition" "item_condition" NOT NULL,
	"quantity_available" integer,
	"city" text,
	"country" text NOT NULL,
	"price_type" "price_type" DEFAULT 'ON_REQUEST' NOT NULL,
	"price_min" numeric(14, 2),
	"price_max" numeric(14, 2),
	"currency" text DEFAULT 'USD' NOT NULL,
	"price_status" "data_status" DEFAULT 'PENDING_VERIFICATION' NOT NULL,
	"availability_status" "data_status" DEFAULT 'SUPPLIER_PROVIDED' NOT NULL,
	"lead_time_days" integer,
	"certification" text,
	"certification_status" "data_status" DEFAULT 'PENDING_VERIFICATION' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manufacturers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"country" text,
	"cage_code" text,
	"website" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rfq_id" uuid NOT NULL,
	"supplier_org_id" uuid NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"sender_user_id" uuid NOT NULL,
	"sender_org_id" uuid NOT NULL,
	"body" text NOT NULL,
	"quotation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" "org_kind" NOT NULL,
	"country" text NOT NULL,
	"city" text,
	"is_suspended" boolean DEFAULT false NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_cross_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"related_product_id" uuid NOT NULL,
	"type" "cross_ref_type" NOT NULL,
	"evidence" text NOT NULL,
	"data_status" "data_status" DEFAULT 'PENDING_VERIFICATION' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_number" text NOT NULL,
	"pn_normalized" text NOT NULL,
	"manufacturer_id" uuid,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"nsn" text,
	"model_number" text,
	"specs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"unit_of_measure" text DEFAULT 'EA' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"export_control_status" "export_control_status" DEFAULT 'UNKNOWN' NOT NULL,
	"control_classification" text,
	"data_status" "data_status" DEFAULT 'PENDING_VERIFICATION' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(part_number,'') || ' ' || coalesce(description,'') || ' ' || coalesce(category,'') || ' ' || coalesce(model_number,'') || ' ' || coalesce(nsn,''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotation_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quotation_id" uuid NOT NULL,
	"rfq_line_id" uuid NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"availability" text NOT NULL,
	"lead_time_days" integer NOT NULL,
	"condition" "item_condition" NOT NULL,
	"certification" text,
	"country_of_origin" text,
	"warranty" text,
	"ship_from_country" text,
	"ship_from_city" text
);
--> statement-breakpoint
CREATE TABLE "quotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rfq_id" uuid NOT NULL,
	"supplier_org_id" uuid NOT NULL,
	"submitted_by_user_id" uuid NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"status" "quotation_status" DEFAULT 'SUBMITTED' NOT NULL,
	"currency" text NOT NULL,
	"incoterm" text,
	"freight" numeric(14, 2),
	"insurance" numeric(14, 2),
	"payment_terms" text,
	"valid_until" date,
	"remarks" text,
	"revision_note" text,
	"is_shortlisted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rfq_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rfq_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" uuid,
	"part_number" text,
	"manufacturer_name" text,
	"description" text NOT NULL,
	"category" text,
	"quantity" numeric(14, 3) NOT NULL,
	"unit" text DEFAULT 'EA' NOT NULL,
	"quantity_text" text,
	"quantity_approximate" boolean DEFAULT false NOT NULL,
	"condition" "item_condition" DEFAULT 'NEW' NOT NULL,
	"certification_required" text,
	"identification" "identification_status" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rfq_recipients" (
	"rfq_id" uuid NOT NULL,
	"supplier_org_id" uuid NOT NULL,
	"status" "recipient_status" DEFAULT 'SENT' NOT NULL,
	"match_reason" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"viewed_at" timestamp with time zone,
	CONSTRAINT "rfq_recipients_rfq_id_supplier_org_id_pk" PRIMARY KEY("rfq_id","supplier_org_id")
);
--> statement-breakpoint
CREATE TABLE "rfqs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref_no" integer GENERATED ALWAYS AS IDENTITY (sequence name "rfqs_ref_no_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 10001 CACHE 1),
	"buyer_org_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"status" "rfq_status" DEFAULT 'DRAFT' NOT NULL,
	"destination_city" text,
	"destination_country" text,
	"destination_text" text,
	"required_by" date,
	"notes" text,
	"compliance_reason" text,
	"source_conversation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"mfa_passed" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_oem_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_org_id" uuid NOT NULL,
	"manufacturer_id" uuid NOT NULL,
	"relationship" "supplier_type" NOT NULL,
	"data_status" "data_status" DEFAULT 'PENDING_VERIFICATION' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_profiles" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"supplier_type" "supplier_type" NOT NULL,
	"region" text,
	"categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"markets_served" text[] DEFAULT '{}'::text[] NOT NULL,
	"about" text,
	"response_rate" numeric(5, 2),
	"avg_response_hours" numeric(8, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"level" "verification_level" NOT NULL,
	"state" "verification_state" DEFAULT 'PENDING' NOT NULL,
	"evidence_note" text,
	"evidence_document_id" uuid,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"mobile" text,
	"country" text,
	"password_hash" text NOT NULL,
	"role" "org_role" DEFAULT 'PROCUREMENT_OFFICER' NOT NULL,
	"is_platform_admin" boolean DEFAULT false NOT NULL,
	"mfa_secret" text,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "compliance_country_rules" ADD CONSTRAINT "compliance_country_rules_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_reviews" ADD CONSTRAINT "compliance_reviews_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_reviews" ADD CONSTRAINT "compliance_reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_org_id_organizations_id_fk" FOREIGN KEY ("owner_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_listings" ADD CONSTRAINT "inventory_listings_supplier_org_id_organizations_id_fk" FOREIGN KEY ("supplier_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_listings" ADD CONSTRAINT "inventory_listings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_supplier_org_id_organizations_id_fk" FOREIGN KEY ("supplier_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_org_id_organizations_id_fk" FOREIGN KEY ("sender_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_subscriptions" ADD CONSTRAINT "organization_subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_subscriptions" ADD CONSTRAINT "organization_subscriptions_plan_id_commercial_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."commercial_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_cross_references" ADD CONSTRAINT "product_cross_references_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_cross_references" ADD CONSTRAINT "product_cross_references_related_product_id_products_id_fk" FOREIGN KEY ("related_product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_rfq_line_id_rfq_lines_id_fk" FOREIGN KEY ("rfq_line_id") REFERENCES "public"."rfq_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_supplier_org_id_organizations_id_fk" FOREIGN KEY ("supplier_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_lines" ADD CONSTRAINT "rfq_lines_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_lines" ADD CONSTRAINT "rfq_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_recipients" ADD CONSTRAINT "rfq_recipients_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_recipients" ADD CONSTRAINT "rfq_recipients_supplier_org_id_organizations_id_fk" FOREIGN KEY ("supplier_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_buyer_org_id_organizations_id_fk" FOREIGN KEY ("buyer_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_oem_relationships" ADD CONSTRAINT "supplier_oem_relationships_supplier_org_id_organizations_id_fk" FOREIGN KEY ("supplier_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_oem_relationships" ADD CONSTRAINT "supplier_oem_relationships_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_profiles" ADD CONSTRAINT "supplier_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_verifications" ADD CONSTRAINT "supplier_verifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_verifications" ADD CONSTRAINT "supplier_verifications_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_org_idx" ON "audit_logs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "compliance_rfq_idx" ON "compliance_reviews" USING btree ("rfq_id");--> statement-breakpoint
CREATE INDEX "convmsg_conv_idx" ON "conversation_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "conv_user_idx" ON "conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "conv_anon_idx" ON "conversations" USING btree ("anon_token_hash");--> statement-breakpoint
CREATE INDEX "documents_org_idx" ON "documents" USING btree ("owner_org_id");--> statement-breakpoint
CREATE INDEX "documents_rfq_idx" ON "documents" USING btree ("rfq_id");--> statement-breakpoint
CREATE INDEX "inv_product_idx" ON "inventory_listings" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "inv_supplier_idx" ON "inventory_listings" USING btree ("supplier_org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manufacturers_name_uq" ON "manufacturers" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "thread_uq" ON "message_threads" USING btree ("rfq_id","supplier_org_id");--> statement-breakpoint
CREATE INDEX "messages_thread_idx" ON "messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "xref_product_idx" ON "product_cross_references" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_pn_mfr_uq" ON "products" USING btree ("pn_normalized","manufacturer_id");--> statement-breakpoint
CREATE INDEX "products_pn_trgm_idx" ON "products" USING gin ("pn_normalized" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "products_search_idx" ON "products" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "products_nsn_idx" ON "products" USING btree ("nsn");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree (lower("category"));--> statement-breakpoint
CREATE UNIQUE INDEX "quotations_rev_uq" ON "quotations" USING btree ("rfq_id","supplier_org_id","revision");--> statement-breakpoint
CREATE INDEX "quotations_rfq_idx" ON "quotations" USING btree ("rfq_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rfq_lines_uq" ON "rfq_lines" USING btree ("rfq_id","line_no");--> statement-breakpoint
CREATE INDEX "rfqrec_supplier_idx" ON "rfq_recipients" USING btree ("supplier_org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rfqs_ref_uq" ON "rfqs" USING btree ("ref_no");--> statement-breakpoint
CREATE INDEX "rfqs_buyer_idx" ON "rfqs" USING btree ("buyer_org_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sor_uq" ON "supplier_oem_relationships" USING btree ("supplier_org_id","manufacturer_id");--> statement-breakpoint
CREATE INDEX "supver_org_idx" ON "supplier_verifications" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_org_idx" ON "users" USING btree ("organization_id");