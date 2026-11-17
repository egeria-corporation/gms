// SPDX-License-Identifier: AGPL-3.0-only
// What both applicant editors show of live co-editing (lib/presence.ts, docs/co-editing.md): who is
// in the draft now, a "{name} is editing" chip at the question or section each person is in, the
// soft lock's "Being edited by {name}", the "{name} changed this" note with the other version, and
// a quiet note when live updates are paused. Status is always an icon and words.
import { useEffect, useId, useState, type RefObject } from "react";
import { Eye, EyeOff, Info, Lock, PencilLine, WifiOff } from "lucide-react";
import type { Json } from "@gms/forms";
import { Avatar } from "../../components/applicant.tsx";
import type { LiveStatus, Peer } from "../../lib/presence.ts";
import { t } from "./i18n.ts";

/** Who is in this draft right now: this person first, then everyone else, as initials. */
export function PresenceAvatars({ me, peers }: { me: string; peers: Peer[] }) {
  return (
    <div className="pres" role="img" aria-label={t("editor.editingNow", { names: [me, ...peers.map((p) => p.name)].join(", ") })}>
      <Avatar name={me} note={t("editor.youNote")} live />
      {peers.map((p, i) => (
        <Avatar key={p.userId} name={p.name} {...(p.section ? { note: `· ${p.section}` } : {})} index={i + 1} live />
      ))}
    </div>
  );
}

/** Said quietly when the live channel is not there: the editor works as before, without live updates. */
export function PausedNote({ status }: { status: LiveStatus }) {
  if (status !== "paused") return null;
  return (
    <span className="small muted row" role="status" style={{ gap: "6px" }}>
      <WifiOff className="ic ic-sm" aria-hidden="true" />
      {t("presence.paused")}
    </span>
  );
}

/** "{name} is editing", one chip per person. */
export function EditingChips({ peers }: { peers: Peer[] }) {
  if (!peers.length) return null;
  return (
    <span className="row" style={{ gap: "6px", flexWrap: "wrap" }}>
      {peers.map((p) => (
        <span key={p.userId} className="bdg bdg-info">
          <PencilLine className="ic" aria-hidden="true" />
          {t("presence.isEditing", { name: p.name })}
        </span>
      ))}
    </span>
  );
}

/** The soft lock: the question is read-only for everyone but the person typing in it. */
export function LockNote({ peer, id }: { peer: Peer; id?: string }) {
  return (
    <span className="bdg bdg-warn" id={id}>
      <Lock className="ic" aria-hidden="true" />
      {t("presence.beingEditedBy", { name: peer.name })}
    </span>
  );
}

/** Someone else's saved version of a value, as words to read. */
export function versionText(v: Json | undefined): string | null {
  if (v === undefined || v === null || v === "") return null;
  return typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v, null, 2);
}

/**
 * Someone saved this question while this person had unsaved changes in it: theirs stays on screen,
 * and the other version is a click away. "Use their version" replaces it; "Keep mine" closes the note.
 */
export function ChangedNote({ name, theirs, onKeep, onUseTheirs }: { name: string; theirs: string | null; onKeep: () => void; onUseTheirs?: () => void }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="bnr bnr-info" style={{ padding: "8px 12px", alignSelf: "stretch" }}>
      <Info className="ic" aria-hidden="true" />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="t" style={{ fontSize: "13px" }}>
          {t("presence.changedThis", { name })}
        </div>
        <div id={id} hidden={!open} style={{ marginTop: "6px" }}>
          {theirs ? (
            <p className="small" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {theirs}
            </p>
          ) : (
            <p className="small">{t("presence.theyClearedIt")}</p>
          )}
        </div>
        <div className="row" style={{ gap: "8px", marginTop: "6px", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-sm btn-secondary" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
            {open ? <EyeOff className="ic" aria-hidden="true" /> : <Eye className="ic" aria-hidden="true" />}
            {open ? t("presence.hideTheirVersion") : t("presence.viewTheirVersion")}
          </button>
          {onUseTheirs && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={onUseTheirs}>
              {t("presence.useTheirVersion")}
            </button>
          )}
          <button type="button" className="btn btn-sm btn-ghost" onClick={onKeep}>
            {t("presence.keepMine")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------ the form's questions

const slugOf = (question: string) => question.replace(/[^\w-]/g, "-");

/**
 * The field FormView draws for each question (`/key`), found from the help element every field
 * carries (`<id>-help`, the id being the renderer's own prefix plus the question's path). The prefix
 * is the one most fields agree on.
 */
export function fieldsOf(container: HTMLElement, questions: readonly string[]): Map<string, HTMLElement> {
  const bySlug = new Map(questions.map((q) => [slugOf(q), q] as const));
  const helps = [...container.querySelectorAll<HTMLElement>(".fld > .row > .help[id$='-help']")];
  const ids = helps.map((h) => h.id.slice(0, -"-help".length));
  const votes = new Map<string, number>();
  for (const id of ids) for (const s of bySlug.keys()) if (id.endsWith(s)) votes.set(id.slice(0, id.length - s.length), (votes.get(id.slice(0, id.length - s.length)) ?? 0) + 1);
  let prefix: string | null = null;
  let best = 0;
  for (const [p, n] of votes) if (n > best) [prefix, best] = [p, n];
  const out = new Map<string, HTMLElement>();
  if (prefix === null) return out;
  helps.forEach((h, i) => {
    const id = ids[i]!;
    const q = id.startsWith(prefix!) ? bySlug.get(id.slice(prefix!.length)) : undefined;
    const fld = h.closest<HTMLElement>(".fld");
    if (q && fld && !out.has(q)) out.set(q, fld);
  });
  return out;
}

/** The question an element of the form belongs to, or null (a control outside every question). */
export function questionAt(el: Element | null, fields: Map<string, HTMLElement>): string | null {
  for (const [q, fld] of fields) if (el && fld.contains(el)) return q;
  return null;
}

/**
 * A place inside each named question's field for its presence notes, kept as the form re-renders
 * (a field drawn again, a category shown): right under the field's label.
 */
export function useFieldSlots(container: RefObject<HTMLElement | null>, wanted: readonly string[], questions: readonly string[]): Map<string, HTMLElement> {
  const [slots, setSlots] = useState<Map<string, HTMLElement>>(() => new Map());
  const key = [...wanted].sort().join("\n");
  const all = questions.join("\n");
  useEffect(() => {
    const root = container.current;
    if (!root) return;
    const names = new Set(key ? key.split("\n") : []);
    const place = () => {
      // Places no longer needed go, so an empty one never adds a gap to the field.
      for (const old of root.querySelectorAll<HTMLElement>("[data-co-slot]")) if (!names.has(old.dataset.coSlot ?? "")) old.remove();
      const fields = names.size ? fieldsOf(root, all.split("\n")) : new Map<string, HTMLElement>();
      const next = new Map<string, HTMLElement>();
      for (const q of names) {
        const fld = fields.get(q);
        if (!fld) continue;
        let slot = [...fld.children].find((c): c is HTMLElement => c instanceof HTMLElement && c.dataset.coSlot === q);
        if (!slot) {
          slot = document.createElement("div");
          slot.dataset.coSlot = q;
          slot.style.display = "flex";
          slot.style.flexDirection = "column";
          slot.style.alignItems = "flex-start";
          slot.style.gap = "6px";
          const label = [...fld.children].find((c) => c.classList.contains("lbl"));
          fld.insertBefore(slot, label ? label.nextSibling : fld.firstChild);
        }
        next.set(q, slot);
      }
      setSlots((prev) => (prev.size === next.size && [...next].every(([q, el]) => prev.get(q) === el) ? prev : next));
    };
    place();
    if (!names.size) return;
    const watch = new MutationObserver(place);
    watch.observe(root, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, [container, key, all]);
  return slots;
}
