-- Customers sign in before they belong to any business, so the app can't see
-- their row through RLS yet. This finds the customer by verified phone or
-- email, creating one if needed, and returns only the id. Callers must pass
-- a phone or email the person has just proven they control.
CREATE OR REPLACE FUNCTION customer_upsert(p_phone text, p_email text)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
  DECLARE
    v_id uuid;
  BEGIN
    IF (p_phone IS NULL) = (p_email IS NULL) THEN
      RAISE EXCEPTION 'customer_upsert needs exactly one of phone or email';
    END IF;

    IF p_phone IS NOT NULL THEN
      INSERT INTO customer (phone_e164) VALUES (p_phone)
        ON CONFLICT (phone_e164) DO NOTHING
        RETURNING id INTO v_id;
      IF v_id IS NULL THEN
        SELECT id INTO v_id FROM customer WHERE phone_e164 = p_phone;
      END IF;
    ELSE
      INSERT INTO customer (email) VALUES (lower(p_email))
        ON CONFLICT ((lower(email))) DO NOTHING
        RETURNING id INTO v_id;
      IF v_id IS NULL THEN
        SELECT id INTO v_id FROM customer WHERE lower(email) = lower(p_email);
      END IF;
    END IF;

    RETURN v_id;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION customer_upsert(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION customer_upsert(text, text) TO wepunch_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON customer_challenge, customer_session TO wepunch_app;
