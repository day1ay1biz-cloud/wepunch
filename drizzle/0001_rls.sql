-- Tenant isolation with Postgres Row-Level Security.
--
-- The app connects as a login role that is a member of `wepunch_app`. That role
-- does not own these tables, so every policy below applies to it. The table
-- owner (used only for migrations, seeds and the platform admin console)
-- bypasses RLS because FORCE ROW LEVEL SECURITY is not set.
--
-- Each request sets its scope inside a transaction with set_config(..., true):
--   app.business_id  the business the request acts for
--   app.agency_id    an agency whose businesses the request may act for
--   app.customer_id  the signed-in customer (customer card pages)
-- An empty or missing setting matches nothing, so unscoped queries see no rows.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wepunch_app') THEN
    CREATE ROLE wepunch_app NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO wepunch_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO wepunch_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO wepunch_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wepunch_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO wepunch_app;
--> statement-breakpoint
-- The drizzle migrations bookkeeping table is not the app's business.
REVOKE ALL ON ALL TABLES IN SCHEMA drizzle FROM wepunch_app;
--> statement-breakpoint

-- Append-only ledgers: corrections are new rows, never edits.
REVOKE UPDATE, DELETE ON punch_event, audit_log FROM wepunch_app;
--> statement-breakpoint

-- Scope helpers -------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_setting_uuid(name text) RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting(name, true), '')::uuid $$;
--> statement-breakpoint

-- True when the current scope may act for business `bid`: either it is the
-- scoped business, or it belongs to the scoped agency. SECURITY DEFINER so the
-- lookup on `business` is not itself filtered by RLS.
CREATE OR REPLACE FUNCTION app_can_access(bid uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT bid IS NOT NULL AND (
      bid = app_setting_uuid('app.business_id')
      OR EXISTS (
        SELECT 1 FROM business b
        WHERE b.id = bid
          AND b.agency_id IS NOT NULL
          AND b.agency_id = app_setting_uuid('app.agency_id')
      )
    )
  $$;
--> statement-breakpoint

-- Tenant routing runs before any scope exists: look a business up by slug or
-- custom domain, returning only what routing needs.
CREATE OR REPLACE FUNCTION resolve_business(p_slug text, p_domain text)
  RETURNS TABLE (id uuid, slug text, status business_status)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT b.id, b.slug, b.status FROM business b
    WHERE (p_slug IS NOT NULL AND b.slug = lower(p_slug))
       OR (p_domain IS NOT NULL AND b.custom_domain = lower(p_domain))
    LIMIT 1
  $$;
--> statement-breakpoint

-- After sign-in, list the businesses and agencies a user may pick from. The
-- caller must pass the id of the authenticated session user, never user input.
CREATE OR REPLACE FUNCTION user_scopes(p_user_id text)
  RETURNS TABLE (kind text, scope_id uuid, name text, slug text, role text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT 'business', b.id, b.name, b.slug, m.role::text
      FROM membership m JOIN business b ON b.id = m.business_id
     WHERE m.user_id = p_user_id AND m.active AND b.status <> 'deleted'
    UNION ALL
    SELECT 'agency', a.id, a.name, NULL, am.role::text
      FROM agency_membership am JOIN agency a ON a.id = am.agency_id
     WHERE am.user_id = p_user_id
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_can_access(uuid), resolve_business(text, text), user_scopes(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_setting_uuid(text), app_can_access(uuid), resolve_business(text, text), user_scopes(text) TO wepunch_app;
--> statement-breakpoint

-- Policies ------------------------------------------------------------------

ALTER TABLE agency ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY agency_scope ON agency
  USING (id = app_setting_uuid('app.agency_id'))
  WITH CHECK (id = app_setting_uuid('app.agency_id'));
--> statement-breakpoint

ALTER TABLE agency_membership ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY agency_membership_scope ON agency_membership
  USING (agency_id = app_setting_uuid('app.agency_id'))
  WITH CHECK (agency_id = app_setting_uuid('app.agency_id'));
--> statement-breakpoint

-- A new business is created by generating its id, scoping to it, then inserting.
ALTER TABLE business ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY business_scope ON business
  USING (app_can_access(id))
  WITH CHECK (app_can_access(id));
--> statement-breakpoint

ALTER TABLE location ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY location_scope ON location
  USING (app_can_access(business_id)) WITH CHECK (app_can_access(business_id));
--> statement-breakpoint

ALTER TABLE membership ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY membership_scope ON membership
  USING (app_can_access(business_id)) WITH CHECK (app_can_access(business_id));
--> statement-breakpoint

ALTER TABLE program ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY program_scope ON program
  USING (app_can_access(business_id)) WITH CHECK (app_can_access(business_id));
--> statement-breakpoint

ALTER TABLE customer_consent ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY customer_consent_scope ON customer_consent
  USING (app_can_access(business_id) OR customer_id = app_setting_uuid('app.customer_id'))
  WITH CHECK (app_can_access(business_id));
--> statement-breakpoint

ALTER TABLE card ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY card_scope ON card
  USING (app_can_access(business_id) OR customer_id = app_setting_uuid('app.customer_id'))
  WITH CHECK (app_can_access(business_id));
--> statement-breakpoint

ALTER TABLE device ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY device_scope ON device
  USING (app_can_access(business_id)) WITH CHECK (app_can_access(business_id));
--> statement-breakpoint

ALTER TABLE punch_event ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY punch_event_scope ON punch_event
  USING (app_can_access(business_id)) WITH CHECK (app_can_access(business_id));
--> statement-breakpoint

ALTER TABLE reward ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY reward_scope ON reward
  USING (app_can_access(business_id) OR customer_id = app_setting_uuid('app.customer_id'))
  WITH CHECK (app_can_access(business_id));
--> statement-breakpoint

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_log_scope ON audit_log
  USING (app_can_access(business_id)) WITH CHECK (app_can_access(business_id));
--> statement-breakpoint

ALTER TABLE subscription ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY subscription_scope ON subscription
  USING (app_can_access(business_id)) WITH CHECK (app_can_access(business_id));
--> statement-breakpoint

-- Customers are platform-wide. A tenant sees a customer only through one of its
-- own cards (the card policy filters the subquery); a customer sees themself.
-- Enrollment inserts the customer with app.customer_id set to the new id.
ALTER TABLE customer ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY customer_visible ON customer
  USING (
    id = app_setting_uuid('app.customer_id')
    OR EXISTS (SELECT 1 FROM card c WHERE c.customer_id = customer.id)
  )
  WITH CHECK (
    id = app_setting_uuid('app.customer_id')
    OR EXISTS (SELECT 1 FROM card c WHERE c.customer_id = customer.id)
  );
