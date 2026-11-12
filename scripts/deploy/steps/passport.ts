// SPDX-License-Identifier: AGPL-3.0-only
// passport: connecting the instance to Passport. Another track adds the body; this is the stub.
import type { Ctx, Result } from "../core.ts";
import { res } from "../core.ts";

export async function passport(_ctx: Ctx): Promise<Result> {
  return res("needs_input", "Connecting to Passport is not available yet in this tool. Follow docs/self-host.md section 5 by hand for now.", {}, null);
}
