// Runs before every test file: tests must never send real email or texts.
process.env.RESEND_API_KEY = "";
delete process.env.TWILIO_ACCOUNT_SID;
delete process.env.TWILIO_AUTH_TOKEN;
delete process.env.TWILIO_VERIFY_SERVICE_SID;
process.env.BETTER_AUTH_SECRET ||= "test-secret-for-hmac-only";
