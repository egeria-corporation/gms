// SPDX-License-Identifier: AGPL-3.0-or-later
// @gms/ui: design system, components, patterns and shells. Framework-agnostic React.
// The branding engine lives at "@gms/ui/theme" (pure TS); its public API is re-exported here too.

// Utilities
export { cn, countWords, formatBytes, initials, plural } from './lib/utils';
export { AppLink, type AppLinkProps, type LinkComponent, type LinkLikeProps } from './lib/link';

// Theme (pure TS)
export * from './theme';

// Base components
export * from './components/alert';
export * from './components/alert-dialog';
export * from './components/avatar';
export * from './components/badge';
export * from './components/breadcrumb';
export * from './components/button';
export * from './components/card';
export * from './components/checkbox';
export * from './components/command';
export * from './components/dialog';
export * from './components/dropdown-menu';
export * from './components/field';
export * from './components/input';
export * from './components/kbd';
export * from './components/label';
export * from './components/pagination';
export * from './components/popover';
export * from './components/progress';
export * from './components/radio-group';
export * from './components/select';
export * from './components/separator';
export * from './components/sheet';
export * from './components/skeleton';
export * from './components/skip-link';
export * from './components/switch';
export * from './components/table';
export * from './components/tabs';
export * from './components/textarea';
export * from './components/toaster';
export * from './components/tooltip';
export * from './components/visually-hidden';

// Patterns
export * from './patterns/actor-badge';
export * from './patterns/ai-draft-chip';
export * from './patterns/applicant-supplied-quote';
export * from './patterns/approval-request-card';
export * from './patterns/autosave-indicator';
export * from './patterns/brand-pattern';
export * from './patterns/charts';
export * from './patterns/county-map';
export * from './patterns/data-table';
export * from './patterns/deadline-chip';
export * from './patterns/description-list';
export * from './patterns/file-dropzone';
export * from './patterns/kanban';
export * from './patterns/money-display';
export * from './patterns/page-header';
export * from './patterns/powered-by-footer';
export * from './patterns/progress-rail';
export * from './patterns/risk-chip';
export * from './patterns/section';
export * from './patterns/stat-tile';
export * from './patterns/states';
export * from './patterns/status-chip';
export * from './patterns/status-icons';
export * from './patterns/step-up-dialog';
export * from './patterns/timeline';
export * from './patterns/use-now';
export * from './patterns/validation-summary';
export * from './safe-html';

// Shells
export * from './shells/shared';
export * from './shells/public-shell';
export * from './shells/portal-shell';
export * from './shells/console-shell';
export * from './shells/reviewer-shell';
