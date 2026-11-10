// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../src/app/App.tsx";
import { createMockServices } from "../src/app/services.tsx";
import { Dialog } from "../src/components/Dialog.tsx";
import { demoSession } from "../src/mocks/auth.ts";

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}
function open(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App services={createMockServices({ session: demoSession() })} />
      <Where />
    </MemoryRouter>,
  );
}

function Harness() {
  const [isOpen, setOpen] = useState(false);
  return (
    <div className="gms">
      <button onClick={() => setOpen(true)}>Open</button>
      <Dialog open={isOpen} onClose={() => setOpen(false)} labelledBy="t">
        <div className="hd">
          <h2 id="t">Title</h2>
        </div>
        <div className="ft">
          <button>First</button>
          <button>Last</button>
        </div>
      </Dialog>
    </div>
  );
}

describe("Dialog", () => {
  it("moves focus in, traps Tab, closes on Escape and returns focus", async () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open" });
    await userEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Title" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByRole("button", { name: "First" })).toHaveFocus();
    await userEvent.tab();
    expect(within(dialog).getByRole("button", { name: "Last" })).toHaveFocus();
    await userEvent.tab();
    expect(within(dialog).getByRole("button", { name: "First" })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(within(dialog).getByRole("button", { name: "Last" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});

describe("sign dialog", () => {
  it("opens from Review and sign and enables Sign only with a typed name and the attestation", async () => {
    open("/w/alder-creek/grants/awd_01J2Q7/offer");
    expect(await screen.findByRole("button", { name: /Review and sign/ })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Review and sign/ }));

    const dialog = screen.getByRole("dialog", { name: "Sign the grant agreement" });
    const sign = within(dialog).getByRole("button", { name: /Sign agreement/ });
    expect(sign).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("Type your full legal name"), "Maria Santos");
    expect(sign).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("checkbox"));
    expect(sign).toBeEnabled();
    await userEvent.clear(within(dialog).getByLabelText("Type your full legal name"));
    expect(sign).toBeDisabled();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("submit dialog", () => {
  it("is open on the submit route, closes, and reopens from Submit", async () => {
    open("/w/alder-creek/applications/app_01HZX4/edit/submit");
    const dialog = await screen.findByRole("dialog", { name: "Ready to submit?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Submit…" }));
    expect(screen.getByRole("dialog", { name: "Ready to submit?" })).toBeInTheDocument();
  });
});

describe("conflict-of-interest dialog", () => {
  it("gates scoring behind all three declarations", async () => {
    open("/review/assignments");
    await userEvent.click(
      (await screen.findAllByRole("link", { name: /Alder Creek|Open|Score|Start/ })).find(
        (a) => a.getAttribute("aria-haspopup") === "dialog",
      )!,
    );
    const dialog = screen.getByRole("dialog", { name: /Before you open/ });
    const go = within(dialog).getByRole("button", { name: "Continue to scoring" });
    const boxes = within(dialog).getAllByRole("checkbox");
    expect(boxes).toHaveLength(3);
    await userEvent.click(boxes[0]!);
    await userEvent.click(boxes[1]!);
    expect(go).toBeDisabled();
    await userEvent.click(boxes[2]!);
    expect(go).toBeEnabled();
    await userEvent.click(go);
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/review/score/app_01HZX4"));
  });
});
