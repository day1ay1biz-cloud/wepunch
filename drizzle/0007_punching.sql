CREATE TABLE "card_token_use" (
	"nonce" text NOT NULL,
	"action" text NOT NULL,
	"business_id" uuid NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_token_use_nonce_action_pk" PRIMARY KEY("nonce","action")
);
--> statement-breakpoint
ALTER TABLE "punch_event" ADD COLUMN "reverses_event_id" uuid;--> statement-breakpoint
ALTER TABLE "card_token_use" ADD CONSTRAINT "card_token_use_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_event" ADD CONSTRAINT "punch_event_reverses_event_id_unique" UNIQUE("reverses_event_id");