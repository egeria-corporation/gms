// SPDX-License-Identifier: AGPL-3.0-only
// Review parity: anonymized review (what a reviewer reads instead of who applied) and the
// competition-wide conflict-of-interest policy.
import { describe, expect, it } from "vitest";
import {
  APPLICANT_PLACEHOLDER,
  DEFAULT_COI_POLICY,
  anonymizeResponse,
  anonymousName,
  applicantCode,
  declaredMatches,
  domainOf,
  hasSignedCurrent,
  identityTerms,
  matchDeclaredOrgs,
  mentionsApplicant,
  neutralFileName,
  normalizeOrgName,
  redactText,
  redactValue,
} from "../src/index.ts";

const terms = identityTerms({
  names: ["Alder Creek Family Services, Inc.", "Alder Creek", "alder-creek"],
  websites: ["https://www.aldercreekfs.org/about"],
  emails: ["director@aldercreekfs.org"],
  numbers: ["12-3456789"],
});

describe("applicant codes", () => {
  it("are short, stable and start at A-1001", () => {
    expect(applicantCode(1)).toBe("A-1001");
    expect(applicantCode(42)).toBe("A-1042");
    expect(anonymousName(applicantCode(42))).toBe("Applicant A-1042");
    expect(() => applicantCode(0)).toThrow(RangeError);
  });
});

describe("identity terms", () => {
  it("collect names (with and without a legal suffix), domains, the domain's own word and the EIN digits", () => {
    expect(terms.names).toEqual(expect.arrayContaining(["Alder Creek Family Services, Inc.", "Alder Creek Family Services", "Alder Creek", "alder-creek", "aldercreekfs"]));
    expect(terms.domains).toEqual(["aldercreekfs.org"]);
    expect(terms.numbers).toEqual(["123456789"]);
    // Longest first, so the full name is replaced before its prefix.
    expect(terms.names[0]).toBe("Alder Creek Family Services, Inc.");
  });

  it("skip names too short to hide without erasing ordinary words", () => {
    expect(identityTerms({ names: ["AB", "  "] }).names).toEqual([]);
  });

  it("read a bare host from a website or an address", () => {
    expect(domainOf("https://www.Alder.org/about")).toBe("alder.org");
    expect(domainOf("alder.org")).toBe("alder.org");
    expect(domainOf("jo@mail.alder.org")).toBe("mail.alder.org");
    expect(domainOf("not a website")).toBeNull();
  });
});

describe("free-text redaction", () => {
  it("replaces the organization's name in any case and spacing", () => {
    expect(redactText("Alder Creek Family Services has served the valley since 1998.", terms)).toBe(`${APPLICANT_PLACEHOLDER} has served the valley since 1998.`);
    expect(redactText("At ALDER   creek we listen first.", terms)).toBe(`At ${APPLICANT_PLACEHOLDER} we listen first.`);
  });

  it("replaces the website, any page on it, and email addresses at its domain", () => {
    expect(redactText("See https://aldercreekfs.org/annual-report or www.aldercreekfs.org.", terms)).toBe(`See ${APPLICANT_PLACEHOLDER} or ${APPLICANT_PLACEHOLDER}.`);
    expect(redactText("Write to grants@aldercreekfs.org today", terms)).toBe(`Write to ${APPLICANT_PLACEHOLDER} today`);
    expect(redactText("Follow @aldercreekfs", terms)).toBe(`Follow @${APPLICANT_PLACEHOLDER}`);
  });

  it("replaces the EIN with or without its dash", () => {
    expect(redactText("EIN 12-3456789; also 123456789.", terms)).toBe(`EIN ${APPLICANT_PLACEHOLDER}; also ${APPLICANT_PLACEHOLDER}.`);
  });

  it("leaves words that only contain the name, and other domains, alone", () => {
    expect(redactText("Balder Creekside is a different place; see notaldercreekfs.org.", terms)).toBe("Balder Creekside is a different place; see notaldercreekfs.org.");
    expect(mentionsApplicant("A plan for rural families", terms)).toBe(false);
    expect(mentionsApplicant("A plan by Alder Creek", terms)).toBe(true);
    // Repeated calls give the same answer (the shared pattern keeps no state between calls).
    expect(mentionsApplicant("A plan by Alder Creek", terms)).toBe(true);
  });

  it("changes nothing when there is nothing to hide", () => {
    expect(redactText("Alder Creek", identityTerms({}))).toBe("Alder Creek");
  });
});

describe("anonymized responses", () => {
  const response = {
    orgName: "Alder Creek Family Services",
    projectTitle: "Mobile health for Alder Creek families",
    need: "Families travel 46 miles. Alder Creek Family Services runs the only clinic.",
    contact: { email: "director@aldercreekfs.org", phone: "+1 555 0100" },
    budget: [{ label: "Outreach by Alder Creek staff", amount: 1000 }],
    letter: { documentId: "doc-1", name: "Alder Creek - support letter.PDF", size: 1200 },
    audit: { passportDocumentId: "pp-9", fileName: "aldercreekfs-audit-2026.pdf" },
    years: 28,
  };

  it("removes identifying fields, redacts the rest and renames attachments", () => {
    const out = anonymizeResponse(response, { identifying: ["/orgName", "/contact", "/missing"], terms });
    expect(out.hidden).toEqual(["/contact", "/orgName"]);
    expect(out.response).toEqual({
      projectTitle: `Mobile health for ${APPLICANT_PLACEHOLDER} families`,
      need: `Families travel 46 miles. ${APPLICANT_PLACEHOLDER} runs the only clinic.`,
      budget: [{ label: `Outreach by ${APPLICANT_PLACEHOLDER} staff`, amount: 1000 }],
      letter: { documentId: "doc-1", name: "Attachment 1.pdf", size: 1200 },
      audit: { passportDocumentId: "pp-9", fileName: "Attachment 2.pdf" },
      years: 28,
    });
    expect(JSON.stringify(out.response)).not.toMatch(/alder/i);
  });

  it("does not modify its input", () => {
    const copy = structuredClone(response);
    anonymizeResponse(response, { identifying: ["/orgName"], terms });
    expect(response).toEqual(copy);
  });

  it("removes a nested field and an array element by pointer", () => {
    const out = anonymizeResponse({ a: { b: "x", c: "y" }, list: ["keep", "drop"] }, { identifying: ["/a/b", "/list/1"], terms });
    expect(out.response).toEqual({ a: { c: "y" }, list: ["keep"] });
  });

  it("names attachments neutrally, keeping only the extension", () => {
    expect(neutralFileName(3, "Board list - Alder.xlsx")).toBe("Attachment 3.xlsx");
    expect(neutralFileName(1)).toBe("Attachment 1");
    expect(redactValue([{ documentId: "d", title: "Alder Creek" }], terms)).toEqual([{ documentId: "d", title: "Attachment 1" }]);
  });
});

describe("conflict-of-interest policy", () => {
  it("has a plain-language default", () => {
    expect(DEFAULT_COI_POLICY).toMatch(/conflict of interest/);
    expect(DEFAULT_COI_POLICY.length).toBeLessThan(2000);
  });

  it("counts a signature for the version signed only", () => {
    expect(hasSignedCurrent(2, [{ policyVersion: 2 }])).toBe(true);
    expect(hasSignedCurrent(2, [{ policyVersion: 1 }])).toBe(false);
    expect(hasSignedCurrent(1, [])).toBe(false);
  });

  it("matches declared organizations by normalized name or website", () => {
    expect(normalizeOrgName("The Alder Creek Family Services, Inc.")).toBe("alder creek family services");
    expect(normalizeOrgName("Smith & Sons LLC")).toBe("smith and sons");
    const alder = { id: "ws-alder", names: ["Alder Creek Family Services"], domains: ["aldercreekfs.org"] };
    const other = { id: "ws-other", names: ["Northgate Housing Trust"], domains: [] };
    expect(declaredMatches({ name: "alder creek family services inc" }, alder)).toBe(true);
    expect(declaredMatches({ name: "Someone", website: "https://www.aldercreekfs.org" }, alder)).toBe(true);
    expect(declaredMatches({ name: "Alder" }, alder)).toBe(false);
    expect(matchDeclaredOrgs([{ name: "Northgate Housing Trust" }, { name: "Unrelated" }], [alder, other])).toEqual(["ws-other"]);
  });
});
