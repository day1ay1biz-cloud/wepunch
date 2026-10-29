-- Invitations are tenant data like any other table with a business_id.
GRANT SELECT, INSERT, UPDATE, DELETE ON invitation TO wepunch_app;
--> statement-breakpoint
ALTER TABLE invitation ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY invitation_scope ON invitation
  USING (app_can_access(business_id)) WITH CHECK (app_can_access(business_id));
--> statement-breakpoint

-- The invitee is not a member yet, so the accept page cannot open a tenant
-- scope to read the invite. This looks one up by the hash of the emailed
-- token and returns only what that page needs. Accepting still happens
-- inside the business's own scope.
CREATE OR REPLACE FUNCTION invitation_by_token(p_token_hash text)
  RETURNS TABLE (
    id uuid,
    business_id uuid,
    business_name text,
    business_slug text,
    email text,
    role membership_role,
    expires_at timestamptz,
    accepted_at timestamptz,
    revoked_at timestamptz
  )
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT i.id, i.business_id, b.name, b.slug, i.email, i.role, i.expires_at, i.accepted_at, i.revoked_at
    FROM invitation i JOIN business b ON b.id = i.business_id
    WHERE i.token_hash = p_token_hash AND b.status <> 'deleted'
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION invitation_by_token(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION invitation_by_token(text) TO wepunch_app;
