CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "membership_role" DEFAULT 'staff' NOT NULL,
	"location_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_accepted_by_user_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_open_per_email_idx" ON "invitation" USING btree ("business_id",lower("email")) WHERE "invitation"."accepted_at" is null and "invitation"."revoked_at" is null;