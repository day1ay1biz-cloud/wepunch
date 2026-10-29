CREATE TABLE "customer_challenge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"destination" text NOT NULL,
	"code_hash" text,
	"provider" text NOT NULL,
	"ip" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_session_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "customer_consent" ADD COLUMN "marketing_sms_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_consent" ADD COLUMN "marketing_email_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_consent" ADD COLUMN "ip" text;--> statement-breakpoint
ALTER TABLE "customer_session" ADD CONSTRAINT "customer_session_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_challenge_destination_idx" ON "customer_challenge" USING btree ("destination","created_at");--> statement-breakpoint
CREATE INDEX "customer_challenge_ip_idx" ON "customer_challenge" USING btree ("ip","created_at");--> statement-breakpoint
CREATE INDEX "customer_session_customer_idx" ON "customer_session" USING btree ("customer_id");