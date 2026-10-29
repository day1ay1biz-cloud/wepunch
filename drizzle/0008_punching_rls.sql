GRANT SELECT, INSERT, UPDATE, DELETE ON card_token_use TO wepunch_app;
--> statement-breakpoint
ALTER TABLE card_token_use ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY card_token_use_scope ON card_token_use
  USING (app_can_access(business_id)) WITH CHECK (app_can_access(business_id));
