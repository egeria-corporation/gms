// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { applicantAccess } from "../src/lib/roles.ts";

describe("applicantAccess", () => {
  it("lets only an admin submit, accept an award, invite, and export", () => {
    for (const role of ["admin", "owner"]) {
      const access = applicantAccess(role);
      expect(access.admin).toBe(true);
      expect(access.submit).toBe(true);
      expect(access.awards).toBe(true);
    }
    for (const role of ["editor", "finance", "viewer", "consultant"]) {
      const access = applicantAccess(role);
      expect(access.admin).toBe(false);
      expect(access.submit).toBe(false);
      expect(access.awards).toBe(false);
    }
  });

  it("lets an editor draft and not a viewer or finance", () => {
    expect(applicantAccess("editor")).toMatchObject({ applications: true, draft: true, reports: true, messages: true, library: true, discovery: true });
    expect(applicantAccess("finance")).toMatchObject({ applications: false, draft: false, reports: true, messages: true, library: false, readReports: true });
    expect(applicantAccess("viewer")).toMatchObject({ applications: false, draft: false, reports: false, messages: false, discovery: true, readReports: true });
    expect(applicantAccess("consultant")).toMatchObject({ applications: true, draft: false, discovery: false, library: false, readReports: false });
  });
});
