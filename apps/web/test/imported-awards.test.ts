// SPDX-License-Identifier: AGPL-3.0-only
// A non-dry-run award import in mock mode has to show up where a tester looks next.
import { describe, expect, it } from "vitest";
import { createMockApi } from "../src/mocks/api.ts";
import { demoSession } from "../src/mocks/auth.ts";

const mapping = { recipientName: "Org", title: "Grant", awardedAmount: "Amount" };

describe("mock award import", () => {
  it("keeps a dry run off the lists and puts a real import on Awards and Grantees", async () => {
    const api = createMockApi({ session: async () => demoSession() });
    await api.workspace("riverbend");
    const beforeAwards = (await api.listAwards()).length;
    const before = await api.listGrantees();
    const alderBefore = before.find((g) => g.name === "Alder Creek Family Services")!.awards;

    const dry = await api.importAwardsCsv({ csv: "Org,Grant,Amount\nNorth Trail Clinic,Winter clinic,12000", mapping, dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, created: 0, failed: 0 });
    expect((await api.listAwards()).length).toBe(beforeAwards);
    expect((await api.listGrantees()).some((g) => g.name === "North Trail Clinic")).toBe(false);

    const committed = await api.importAwardsCsv({
      csv: "Org,Grant,Amount,Status\nNorth Trail Clinic,Winter clinic,12000,active\nAlder Creek Family Services,Van route,50000,closed",
      mapping: { ...mapping, status: "Status" },
    });
    expect(committed).toMatchObject({ dryRun: false, created: 2, failed: 0, unmatchedRecipients: 1 });

    const awards = await api.listAwards();
    const clinic = awards.find((a) => a.title === "Winter clinic");
    const van = awards.find((a) => a.title === "Van route");
    expect(clinic).toMatchObject({ status: "active", awardedAmountMinor: 1_200_000 });
    expect(van).toMatchObject({ status: "completed", awardedAmountMinor: 5_000_000 });

    const grantees = await api.listGrantees();
    const clinicRow = grantees.find((g) => g.name === "North Trail Clinic");
    expect(clinicRow).toMatchObject({ awards: 1, tags: ["imported"] });
    expect(awards.filter((a) => a.recipient?.workspaceId === clinicRow!.workspaceId && a.status !== "cancelled").reduce((n, a) => n + (a.awardedAmountMinor ?? 0), 0)).toBe(1_200_000);
    expect(grantees.find((g) => g.name === "Alder Creek Family Services")!.awards).toBe(alderBefore + 1);
    expect(van?.recipient?.workspaceId).toBe(before.find((g) => g.name === "Alder Creek Family Services")!.workspaceId);
  });

  it("refuses a row with no title and does not write the others in that file when they fail the same check", async () => {
    const api = createMockApi({ session: async () => demoSession() });
    await api.workspace("riverbend");
    const result = await api.importAwardsCsv({ csv: "Org,Grant,Amount\nNorth Trail Clinic,,12000", mapping });
    expect(result).toMatchObject({ created: 0, failed: 1 });
    expect((await api.listGrantees()).some((g) => g.name === "North Trail Clinic")).toBe(false);
  });
});
