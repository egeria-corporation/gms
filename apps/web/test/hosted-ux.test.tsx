// SPDX-License-Identifier: AGPL-3.0-only
// The hosted nonprofit walk: an interrupted authenticator enrollment can be started again, a
// self-declared organization is not shown as Passport, Apply waits for the open date, and the
// sign-in page names the grant the person was applying to.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../src/app/App.tsx";
import { createMockServices } from "../src/app/services.tsx";
import { startSecondStep } from "../src/auth/secondStep.ts";
import type { SecondStepPort } from "../src/auth/secondStep.ts";
import type { TotpEnrollment } from "../src/auth/types.ts";
import { applyGrantOf } from "../src/lib/applyReturn.ts";
import { declaredFacts } from "../src/lib/selfDeclared.ts";
import { DeadlineBadge } from "../src/screens/public/FunderPage.tsx";
import { passportFaqText, pendingOpenDate, takingApplications } from "../src/screens/public/OpportunityPage.tsx";
import { createLinked } from "../src/screens/applicant/outside/NewApplicationDialog.tsx";
import { demoSession } from "../src/mocks/auth.ts";
import { viewport } from "./setup.ts";

const enrollment: TotpEnrollment = { factorId: "new", secret: "SECRET", uri: "otpauth://totp/OpenGrants" };

function port(partial: Partial<SecondStepPort> & Pick<SecondStepPort, "listAllTotpFactors">): SecondStepPort & { removed: string[] } {
  const removed: string[] = [];
  return {
    removed,
    unenrollTotp: async (id) => {
      removed.push(id);
    },
    enrollTotp: async () => enrollment,
    ...partial,
  };
}

describe("startSecondStep", () => {
  it("removes an unverified factor and enrolls again", async () => {
    const auth = port({ listAllTotpFactors: async () => [{ id: "stale", status: "unverified" }] });
    await expect(startSecondStep(auth)).resolves.toEqual({ kind: "enroll", enrollment });
    expect(auth.removed).toEqual(["stale"]);
  });

  it("challenges a verified factor and does not replace it", async () => {
    let enrolled = false;
    const auth = port({
      listAllTotpFactors: async () => [
        { id: "old", status: "unverified" },
        { id: "live", status: "verified" },
      ],
      enrollTotp: async () => {
        enrolled = true;
        return enrollment;
      },
    });
    await expect(startSecondStep(auth)).resolves.toEqual({ kind: "challenge", factorId: "live" });
    expect(auth.removed).toEqual([]);
    expect(enrolled).toBe(false);
  });
});

describe("the sign-in page after a failed enrollment", () => {
  function open(path: string, services = createMockServices({ session: demoSession("aal1"), memberships: [] })) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <App services={services} />
      </MemoryRouter>,
    );
  }

  it("shows a translated sentence and a retry, never the provider's words", async () => {
    const services = createMockServices({ session: demoSession("aal1"), memberships: [] });
    services.auth.listAllTotpFactors = async () => [];
    services.auth.enrollTotp = async () => {
      throw new Error('A factor with the friendly name "" already exists');
    };
    open("/signin?step=mfa", services);
    expect(await screen.findByText("Two-step verification could not be started.")).toBeInTheDocument();
    expect(screen.queryByText(/friendly name/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Enter the 6-digit code from your app")).not.toBeInTheDocument();
    services.auth.enrollTotp = async () => enrollment;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByLabelText("Enter the 6-digit code from your app")).toBeInTheDocument();
    expect(screen.getByText("SECRET")).toBeInTheDocument();
  });
});

describe("sign-in names the grant Apply will return to", () => {
  it("reads /apply/{handle}/{slug}", () => {
    expect(applyGrantOf("/apply/midwest-house/the-fund")).toEqual({ handle: "midwest-house", slug: "the-fund" });
    expect(applyGrantOf("/apply/midwest%20house/the-fund")).toEqual({ handle: "midwest house", slug: "the-fund" });
    expect(applyGrantOf("/w/alder-creek")).toBeNull();
    expect(applyGrantOf(null)).toBeNull();
  });

  it("says which grant, and a plain sentence when the title cannot be loaded", async () => {
    const services = createMockServices({ session: null });
    const real = services.api.publicOpportunity.bind(services.api);
    services.api.publicOpportunity = async (handle, slug) => {
      if (slug === "missing") throw new Error("nope");
      return real(handle, slug);
    };
    function Where() {
      const l = useLocation();
      return <output data-testid="where">{l.pathname + l.search}</output>;
    }
    const view = render(
      <MemoryRouter initialEntries={["/signin?next=/apply/riverbend/community-health-2027"]}>
        <App services={services} />
        <Where />
      </MemoryRouter>,
    );
    expect(await screen.findByText("After you sign in, you will return to apply to Community Health Grants 2027.")).toBeInTheDocument();
    view.unmount();
    render(
      <MemoryRouter initialEntries={["/signin?next=/apply/riverbend/missing"]}>
        <App services={services} />
      </MemoryRouter>,
    );
    expect(await screen.findByText("After you sign in, you will return to the grant you opened.")).toBeInTheDocument();
  });
});

describe("a self-declared organization", () => {
  it("reads the typed profile, not Passport", () => {
    expect(
      declaredFacts({
        legalName: "UX Test Nonprofit",
        ein: "123456789",
        website: "https://example.org",
        mission: "Grow food.",
        address: { street: "1 Main", city: "Portland", region: "OR", postalCode: "97201" },
      }),
    ).toEqual({
      legalName: "UX Test Nonprofit",
      ein: "12-3456789",
      website: "example.org",
      mission: "Grow food.",
      address: "1 Main, Portland, OR, 97201",
    });
    expect(declaredFacts(null)).toBeNull();
  });
});

describe("Apply waits for the open date", () => {
  const now = new Date("2026-11-21T18:00:00Z");
  const page = {
    opportunity: {
      status: "open" as const,
      acceptingApplications: false,
      keyDates: {
        postDate: { name: "Opens", eventType: "singleDate" as const, date: "2026-11-30" },
        closeDate: { name: "Closes", eventType: "singleDate" as const, date: "2027-11-30" },
      },
    },
    competitions: [{ id: "c", title: "Round", description: null, instructions: null, status: "open" as const, keyDates: {}, stages: [{ key: "application", label: "Application", opens: "2026-11-30", closes: "2027-11-30", requiresSubmission: true }] }],
  } as Parameters<typeof takingApplications>[0];

  it("does not offer Apply when the server says the call is not open yet", () => {
    expect(takingApplications(page)).toBe(false);
    expect(takingApplications({ ...page, opportunity: { ...page.opportunity, acceptingApplications: true } })).toBe(true);
    expect(pendingOpenDate(page, now)).toBe("2026-11-30");
  });

  it("joins the FAQ sentences with a space", () => {
    const text = passportFaqText("You can set up as not verified.", "Linking OpenGrants Passport is recommended.");
    expect(text).toBe("You can set up as not verified. Linking OpenGrants Passport is recommended.");
    expect(text).not.toContain("verified.Linking");
    expect(passportFaqText("Only this.", null)).toBe("Only this.");
  });

  it("says when a call opens instead of how soon it closes", () => {
    render(<DeadlineBadge opp={page.opportunity} now={now} />);
    expect(screen.getByText(/Opens/)).toBeInTheDocument();
    expect(screen.queryByText(/Closes in/)).not.toBeInTheDocument();
  });
});

describe("an outside draft names its funder", () => {
  it("creates a funder record when none matches, and reuses one that does", async () => {
    const records: { id: string; name: string }[] = [];
    const api = {
      create: async () => ({ id: "app", funderRecordId: null }),
      update: async (_id: string, patch: { funderRecordId: string }) => ({ id: "app", funderRecordId: patch.funderRecordId }),
      createFunderRecord: async (input: { name: string }) => {
        const rec = { id: `rec-${records.length + 1}`, name: input.name };
        records.push(rec);
        return rec;
      },
    };
    const made = await createLinked(api as never, { source: "manual", title: "Supplies", funderName: "City Garden Trust" }, []);
    expect(made.funderRecordId).toBe("rec-1");
    const again = await createLinked(api as never, { source: "manual", title: "More", funderName: "city garden trust" }, records as never);
    expect(again.funderRecordId).toBe("rec-1");
    expect(records).toHaveLength(1);
  });
});

describe("onboarding without Passport", () => {
  function Where() {
    const l = useLocation();
    return <output data-testid="where">{l.pathname + l.search}</output>;
  }
  function open(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <App services={createMockServices({ session: demoSession("aal2"), memberships: [] })} />
        <Where />
      </MemoryRouter>,
    );
  }

  it("Not now opens the profile form instead of going home", async () => {
    open("/onboarding/applicant");
    await userEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect(await screen.findByLabelText(/Legal name/)).toBeInTheDocument();
    expect(screen.getByText("Your organization")).toBeInTheDocument();
    expect(screen.queryByText("Confirm imported profile")).not.toBeInTheDocument();
    expect(screen.getByTestId("where").textContent).toBe("/onboarding/applicant");
  });

  it("the email path does not say the profile was imported", async () => {
    open("/onboarding/applicant?start=email");
    expect(await screen.findByLabelText(/Legal name/)).toBeInTheDocument();
    expect(screen.queryByText("Confirm imported profile")).not.toBeInTheDocument();
  });
});

describe("the applications list on a phone", () => {
  it("is stacked rows", async () => {
    viewport.phone = true;
    try {
      render(
        <MemoryRouter initialEntries={["/w/alder-creek/applications"]}>
          <App services={createMockServices({ session: demoSession() })} />
        </MemoryRouter>,
      );
      expect(await screen.findByRole("link", { name: "Community Clinic Capacity" })).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole("table", { name: "Applications" })).not.toBeInTheDocument());
    } finally {
      viewport.phone = false;
    }
  });
});
