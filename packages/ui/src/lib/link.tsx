// SPDX-License-Identifier: AGPL-3.0-only
// Framework-agnostic links. Pass Next's <Link> as `linkComponent` to get client-side navigation.
import type * as React from 'react';

export interface LinkLikeProps {
  href: string;
  className?: string;
  children?: React.ReactNode;
  'aria-current'?: React.AriaAttributes['aria-current'];
  'aria-label'?: string;
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  target?: string;
  rel?: string;
  prefetch?: boolean;
}

/** Any component that renders an anchor from these props, e.g. `import Link from 'next/link'`. */
export type LinkComponent = React.ComponentType<LinkLikeProps>;

export interface AppLinkProps extends LinkLikeProps {
  linkComponent?: LinkComponent | undefined;
}

/** Renders `linkComponent` when given, otherwise a plain <a>. External links open safely. */
export function AppLink({ linkComponent: Link, prefetch, ...props }: AppLinkProps) {
  const external = /^https?:\/\//i.test(props.href);
  const rel = props.rel ?? (props.target === '_blank' ? 'noopener noreferrer' : undefined);
  if (Link && !external) return <Link {...props} rel={rel} {...(prefetch === undefined ? {} : { prefetch })} />;
  return <a {...props} rel={rel} />;
}
