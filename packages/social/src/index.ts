// SPDX-License-Identifier: AGPL-3.0-only
// Social posting through Zernio (v1.9.0). A port (`SocialPort`) with its HTTP client and a fake;
// the platforms and their limits; the one function that builds the body a post is sent with; the
// webhook signature check; and sealed tokens for the connect state and the preview.
//
// Nothing in this package decides who may post: the GMS service layer does, and only a signed-in
// person's click on Post reaches `createPost`.
export * from "./client.ts";
export * from "./fake.ts";
export * from "./payload.ts";
export * from "./platforms.ts";
export * from "./tokens.ts";
export * from "./webhook.ts";
