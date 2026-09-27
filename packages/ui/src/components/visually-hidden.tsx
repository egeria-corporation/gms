// SPDX-License-Identifier: AGPL-3.0-only
import * as React from 'react';

/** Content for screen readers only. */
export function VisuallyHidden({ asElement = 'span', children, id }: { asElement?: 'span' | 'div' | 'h2' | 'p'; children?: React.ReactNode; id?: string }) {
  return React.createElement(asElement, { className: 'sr-only', id }, children);
}
