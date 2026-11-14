// SPDX-License-Identifier: AGPL-3.0-only
// Two-step verification: authenticator apps name the entry "OpenGrants", because the enrolment
// sends that issuer to Supabase.
import { beforeEach, describe, expect, it, vi } from "vitest";

const enroll = vi.hoisted(() => vi.fn());
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      mfa: { enroll },
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  }),
}));

import { createSupabaseAuth, TOTP_ISSUER } from "../src/auth/supabase.ts";

beforeEach(() => enroll.mockReset());

describe("enrollTotp", () => {
  it("sends the issuer OpenGrants so authenticator apps show that name", async () => {
    enroll.mockResolvedValue({ data: { id: "factor-1", totp: { secret: "S", uri: "otpauth://totp/OpenGrants:a%40b.example?secret=S&issuer=OpenGrants", qr_code: "<svg/>" } }, error: null });
    const auth = createSupabaseAuth("http://supabase.test", "test-anon-key");
    const out = await auth.enrollTotp();
    expect(TOTP_ISSUER).toBe("OpenGrants");
    expect(enroll).toHaveBeenCalledTimes(1);
    expect(enroll).toHaveBeenCalledWith({ factorType: "totp", issuer: "OpenGrants" });
    expect(out).toEqual({ factorId: "factor-1", secret: "S", uri: "otpauth://totp/OpenGrants:a%40b.example?secret=S&issuer=OpenGrants", qrCode: "<svg/>" });
  });

  it("still reports a failed enrolment as an error", async () => {
    enroll.mockResolvedValue({ data: null, error: { message: "Too many requests", status: 429 } });
    const auth = createSupabaseAuth("http://supabase.test", "test-anon-key");
    await expect(auth.enrollTotp()).rejects.toMatchObject({ code: "rate_limited" });
  });
});
