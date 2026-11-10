// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FormDefinition, JsonObject } from "@gms/forms";
import { describe, expect, it, vi } from "vitest";
import { FormView, type FormViewProps } from "../src/forms/FormView.tsx";
import { LOI_FORM, LOI_PROVENANCE, LOI_RESPONSE } from "../src/mocks/forms.ts";

function draw(props: Partial<FormViewProps> = {}) {
  const onChange = vi.fn<(r: JsonObject) => void>();
  const view = render(
    <div className="gms">
      <FormView form={LOI_FORM} response={LOI_RESPONSE} mode="edit" provenance={LOI_PROVENANCE} onChange={onChange} {...props} />
    </div>,
  );
  const last = () => onChange.mock.calls[onChange.mock.calls.length - 1]![0];
  return { ...view, onChange, last };
}

describe("FormView · edit widgets", () => {
  it("text, date, select and number write their values", async () => {
    const { last } = draw();
    const title = screen.getByLabelText(/Project title/);
    await userEvent.clear(title);
    await userEvent.type(title, "Navigation");
    expect(last().projectTitle).toBe("Navigation");

    fireEvent.change(screen.getByLabelText("Planned start date"), { target: { value: "2027-08-01" } });
    expect(last().startDate).toBe("2027-08-01");

    await userEvent.selectOptions(screen.getByLabelText(/Project type/), "Capital");
    expect(last().projectType).toBe("Capital");

    const families = screen.getByLabelText("Families served per year");
    await userEvent.clear(families);
    await userEvent.type(families, "300");
    expect(last().familiesServed).toBe(300);
  });

  it("multi-select and boolean toggle", async () => {
    const { last } = draw();
    const group = screen.getByRole("group", { name: /Populations served/ });
    await userEvent.click(within(group).getByRole("checkbox", { name: "Veterans" }));
    expect(last().populations).toEqual(["Children", "Rural residents", "Veterans"]);
    await userEvent.click(within(group).getByRole("checkbox", { name: "Children" }));
    expect(last().populations).toEqual(["Rural residents", "Veterans"]);
  });

  it("money keeps the competition currency and a decimal string", async () => {
    const { last } = draw();
    const amount = screen.getByLabelText(/Requested amount/);
    await userEvent.clear(amount);
    await userEvent.type(amount, "$120,000");
    expect(last().requestedAmount).toEqual({ amount: "120000", currency: "USD" });
  });

  it("address and phone", async () => {
    const { last } = draw({ showAllErrors: true });
    const address = screen.getByRole("group", { name: /Mailing address/ });
    await userEvent.clear(within(address).getByLabelText("City"));
    expect(last().mailingAddress).not.toHaveProperty("city");
    expect(within(address).getByRole("alert")).toHaveTextContent(/required/);

    const phone = screen.getByLabelText(/Contact phone/);
    await userEvent.clear(phone);
    await userEvent.type(phone, "abc");
    expect(await screen.findByText(/must be a phone number/)).toBeInTheDocument();
  });

  it("rich text is flagged when it carries disallowed markup", async () => {
    draw({ showAllErrors: true });
    fireEvent.change(screen.getByLabelText(/Describe the main activities/), { target: { value: "<p>ok</p><script>alert(1)</script>" } });
    expect(await screen.findByText(/not allowed/)).toBeInTheDocument();
  });

  it("word counter turns over when the limit is passed", async () => {
    draw();
    const need = screen.getByLabelText(/What need does this project address/);
    expect(screen.getByText(/\/ 60 words/)).not.toHaveClass("over");
    fireEvent.change(need, { target: { value: Array.from({ length: 61 }, () => "word").join(" ") } });
    expect(screen.getByText("61 / 60 words")).toHaveClass("over");
  });

  it("repeating group adds and removes rows up to its limit", async () => {
    const { last } = draw();
    const staff = screen.getByRole("group", { name: /Key staff/ });
    await userEvent.click(within(staff).getByRole("button", { name: /Add key staff/ }));
    await userEvent.type(within(staff).getByLabelText("Name, row 3"), "Jamal Reed");
    expect((last().keyStaff as JsonObject[])[2]).toEqual({ name: "Jamal Reed" });
    await userEvent.click(within(staff).getByRole("button", { name: "Remove row 1" }));
    expect(last().keyStaff).toHaveLength(2);
  });

  it("file upload goes through the upload port", async () => {
    const uploadFile = vi.fn(async (f: File) => ({ documentId: "doc_new", name: f.name }));
    const { last, container } = draw({ uploadFile });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await userEvent.upload(input, new File(["x"], "letter.pdf", { type: "application/pdf" }));
    await waitFor(() => expect(last().supportLetter).toEqual({ documentId: "doc_new", name: "letter.pdf" }));
    expect(uploadFile).toHaveBeenCalledOnce();
  });

  it("signature needs a name and the attestation", async () => {
    const { last } = draw({ showAllErrors: true });
    const sig = screen.getByRole("group", { name: /Attestation/ });
    await userEvent.click(within(sig).getByRole("checkbox"));
    expect(last().signature).toEqual({ name: "Maria Santos", attested: false });
    expect(await within(sig).findByText(/attestation box must be checked/)).toBeInTheDocument();
  });

  it("passport fields are read-only, carry provenance and link to Passport", () => {
    draw({ passportUrl: "https://passport.example/org" });
    const legal = screen.getByLabelText(/Legal name/);
    expect(legal).toHaveAttribute("readonly");
    expect(legal).toHaveValue("Alder Creek Family Services");
    expect(screen.getByRole("link", { name: "Edit in Passport" })).toHaveAttribute("href", "https://passport.example/org");
    expect(screen.getAllByText("From Passport").length).toBeGreaterThan(0);
    expect(screen.getByText("From library")).toBeInTheDocument();
    expect(screen.getByText("Agent draft")).toBeInTheDocument();
  });
});

describe("FormView · rules and validation", () => {
  it("SHOW rule reveals the dependent field and hidden fields are not required", async () => {
    draw({ showAllErrors: true });
    expect(screen.queryByLabelText("Fiscal sponsor name")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: /fiscal sponsor/ }));
    expect(screen.getByLabelText("Fiscal sponsor name")).toBeInTheDocument();
  });

  it("DISABLE rule disables the control", () => {
    const form: FormDefinition = {
      ...LOI_FORM,
      uiSchema: {
        type: "VerticalLayout",
        elements: [
          { type: "Control", scope: "#/properties/fiscalSponsor" },
          {
            type: "Control",
            scope: "#/properties/projectTitle",
            rule: { effect: "DISABLE", condition: { scope: "#/properties/fiscalSponsor", schema: { const: false } } },
          },
        ],
      },
    };
    draw({ form });
    expect(screen.getByLabelText(/Project title/)).toBeDisabled();
  });

  it("required errors appear after a field is touched, or at once with showAllErrors", async () => {
    const { unmount } = draw({ response: { ...LOI_RESPONSE, projectTitle: undefined as never } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    const title = screen.getByLabelText(/Project title/);
    await userEvent.click(title);
    await userEvent.tab();
    expect(await screen.findByRole("alert")).toHaveTextContent(/Project title/);
    expect(title).toHaveAttribute("aria-invalid", "true");
    unmount();

    const { projectTitle: _omit, ...rest } = LOI_RESPONSE;
    draw({ response: rest, showAllErrors: true });
    expect(screen.getByRole("alert")).toHaveTextContent(/Project title/);
  });

  it("budget table totals rows and flags a total over the requested amount", async () => {
    const { last } = draw();
    const budget = screen.getByRole("group", { name: /Budget/ });
    expect(within(budget).getByTestId("budget-total")).toHaveTextContent("$150,000");
    expect(within(budget).getByTestId("budget-total")).not.toHaveClass("over");

    const indirect = within(budget).getByLabelText("Amount for Indirect");
    await userEvent.clear(indirect);
    await userEvent.type(indirect, "18000");
    expect(within(budget).getByTestId("budget-total")).toHaveTextContent("$153,000");
    expect(within(budget).getByTestId("budget-total")).toHaveClass("over");
    expect(within(budget).getAllByRole("alert")[0]).toHaveTextContent("exceeds the requested amount by $3,000");
    expect((last().budget as JsonObject[]).find((r) => r.category === "Indirect")!.amount).toEqual({ amount: "18000", currency: "USD" });
  });

  it("autosaves once typing pauses", async () => {
    const onAutosave = vi.fn();
    draw({ onAutosave, autosaveDelayMs: 20 });
    await userEvent.type(screen.getByLabelText(/Project title/), "!!");
    await waitFor(() => expect(onAutosave).toHaveBeenCalledTimes(1));
    expect(onAutosave.mock.calls[0]![0].projectTitle).toMatch(/!!$/);
  });
});

describe("FormView · read-only modes", () => {
  it("reviewer mode removes hidden fields and masks PII for external reviewers only", () => {
    const { unmount } = draw({ mode: "reviewer", externalReviewer: true });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText("Key staff")).not.toBeInTheDocument();
    expect(screen.queryByText("maria.santos@aldercreek.example")).not.toBeInTheDocument();
    expect(screen.getAllByText("Hidden from external reviewers")).toHaveLength(3);
    expect(screen.queryByText("From Passport")).not.toBeInTheDocument();
    unmount();

    draw({ mode: "reviewer", externalReviewer: false });
    expect(screen.getByText("maria.santos@aldercreek.example")).toBeInTheDocument();
    expect(screen.queryByText("Key staff")).not.toBeInTheDocument();
  });

  it("funder mode shows values with provenance and sanitized rich text", () => {
    const { container } = draw({ mode: "funder", response: { ...LOI_RESPONSE, activities: '<p>Fine</p><img src=x onerror="alert(1)">' } });
    expect(screen.getAllByText("From Passport").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$150,000").length).toBeGreaterThan(0);
    expect(screen.getByText("Jul 1, 2027")).toBeInTheDocument();
    expect(screen.getByText("Key staff")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("Fine")).toBeInTheDocument();
  });

  it("print mode is flat: headings, no cards, no chips, no inputs", () => {
    const { container } = draw({ mode: "print" });
    expect(screen.getByRole("heading", { level: 2, name: "Organization" })).toBeInTheDocument();
    expect(container.querySelector(".card")).toBeNull();
    expect(container.querySelector(".prov")).toBeNull();
    expect(container.querySelector("input, textarea, select")).toBeNull();
  });
});
