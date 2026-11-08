import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  ACCENT_PATTERN,
  contrastOnWhite,
  DEFAULT_DESIGN,
  MIN_TEXT_CONTRAST,
  type LetterheadDesign,
  type LetterheadDesignInput,
  type LogoPosition,
  type LogoSize,
} from "@haben/core";
import { useAction } from "../lib/use-action.ts";
import { saveLetterheadDesign } from "../server/functions/logo.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";

/** Ungespeicherte Änderungen an der Gestaltung: Die Vorschau zeigt sie sofort, gespeichert wird erst auf Zuruf */
export function useDesignDraft(initial: LetterheadDesign = DEFAULT_DESIGN) {
  const [saved, setSaved] = useState(initial);
  const [changes, setChanges] = useState<LetterheadDesignInput>({});
  const design = { ...saved, ...changes };
  return {
    design,
    changes,
    dirty: (Object.keys(changes) as (keyof LetterheadDesignInput)[]).some((key) => changes[key] !== saved[key]),
    set: (input: LetterheadDesignInput) => setChanges((current) => ({ ...current, ...input })),
    discard: () => setChanges({}),
    /** Nach dem Speichern: Der Editor lädt nicht neu, damit getippte Eingaben im Formular bleiben */
    commit: () => {
      setSaved(design);
      setChanges({});
    },
  };
}

export type DesignDraft = ReturnType<typeof useDesignDraft>;

const LOGO_SIZE_OPTIONS: { value: LogoSize; label: string; name: string }[] = [
  { value: "s", label: "S", name: "Klein" },
  { value: "m", label: "M", name: "Mittel" },
  { value: "l", label: "L", name: "Groß" },
];

const LOGO_POSITION_OPTIONS: { value: LogoPosition; label: string; name: string }[] = [
  { value: "links", label: "Links", name: "Links" },
  { value: "rechts", label: "Rechts", name: "Rechts" },
];

const SWITCHES = [
  { key: "foldMarks", label: "Falz- und Lochmarken" },
  { key: "giroCode", label: "GiroCode" },
  { key: "customerNumber", label: "Kundennummer" },
  { key: "vatColumn", label: "Spalte USt je Position" },
] as const;

const SWATCHES = [
  { hex: "#1F6F5C", name: "Grün" },
  { hex: "#1D4E89", name: "Blau" },
  { hex: "#6B3FA0", name: "Violett" },
  { hex: "#9B1C1C", name: "Rot" },
  { hex: "#B45309", name: "Orange" },
  { hex: "#3F4A44", name: "Grau" },
];

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string; name: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="btn btn-sm"
          aria-label={option.name}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Logo und Schalter; gleich im Panel der Vorschau und in den Einstellungen */
export function DesignOptionFields({
  design,
  onChange,
  vatRates = 0,
}: {
  design: LetterheadDesign;
  onChange: (input: LetterheadDesignInput) => void;
  /** Steuersätze des geöffneten Belegs; in den Einstellungen gibt es keinen */
  vatRates?: number;
}) {
  return (
    <>
      <section>
        <h3>Logo</h3>
        <div className="design-logo-row">
          <Segmented label="Größe des Logos" options={LOGO_SIZE_OPTIONS} value={design.logoSize} onChange={(logoSize) => onChange({ logoSize })} />
          <Segmented
            label="Seite des Logos"
            options={LOGO_POSITION_OPTIONS}
            value={design.logoPosition}
            onChange={(logoPosition) => onChange({ logoPosition })}
          />
        </div>
      </section>
      <section>
        <h3>Auf dem Blatt</h3>
        {SWITCHES.map(({ key, label }) => (
          <label key={key} className="checkbox">
            <input type="checkbox" checked={design[key]} onChange={(event) => onChange({ [key]: event.target.checked })} />
            {label}
          </label>
        ))}
        {!design.vatColumn && vatRates > 1 && (
          <div className="banner banner-info" role="status">
            Dieser Beleg hat mehrere Steuersätze, deshalb bleibt die Spalte USt stehen.
          </div>
        )}
        <p className="small muted">Bei mehreren Steuersätzen bleibt die Spalte USt stehen. Pflichtangaben und Summen lassen sich nicht ausblenden.</p>
      </section>
    </>
  );
}

function AccentField({ accent, onChange }: { accent: string; onChange: (accent: string) => void }) {
  const weak = ACCENT_PATTERN.test(accent) && contrastOnWhite(accent) < MIN_TEXT_CONTRAST;
  return (
    <section>
      <h3>Farbe</h3>
      <div className="color-swatches">
        {SWATCHES.map((swatch) => (
          <button
            key={swatch.hex}
            type="button"
            className="color-swatch"
            aria-label={swatch.name}
            aria-pressed={accent.toUpperCase() === swatch.hex}
            onClick={() => onChange(swatch.hex)}
          >
            <span style={{ background: swatch.hex }} />
          </button>
        ))}
      </div>
      <label className="design-color">
        Eigene Farbe
        <input type="color" value={accent.toLowerCase()} onChange={(event) => onChange(event.target.value.toUpperCase())} />
        <span className="mono small">{accent}</span>
      </label>
      {weak && (
        <div className="banner banner-info" role="status">
          Diese Farbe ist auf weißem Papier schwer zu lesen.
        </div>
      )}
    </section>
  );
}

/** Spalte neben dem Blatt: Gestaltung ändern und im Blatt sehen, ohne das Formular zu verlassen */
export function DesignPanel({ draft, vatRates }: { draft: DesignDraft; vatRates: number }) {
  const save = useServerFn(saveLetterheadDesign);
  const { busy, notice, run } = useAction();

  const onSave = () =>
    run(async () => {
      await save({ data: draft.changes });
      draft.commit();
    }, "Gespeichert. Gilt für alle Belege, die ab jetzt festgeschrieben werden.");

  return (
    <aside className="design-panel" aria-label="Gestaltung">
      <div className="design-panel-body">
        <AccentField accent={draft.design.accent} onChange={(accent) => draft.set({ accent })} />
        <DesignOptionFields design={draft.design} onChange={draft.set} vatRates={vatRates} />
        <a className="small" href="/einstellungen?bereich=gestaltung" target="_blank" rel="noreferrer">
          Logo und weitere Einstellungen (neuer Tab)
        </a>
      </div>
      <div className="design-panel-foot">
        <p className="small muted">
          Standardgestaltung: gilt für alle Belege, die ab jetzt festgeschrieben werden, auch für offene Entwürfe. Festgeschriebene PDFs bleiben unverändert.
          {draft.dirty && " Beim Schließen der Vorschau gehen ungespeicherte Änderungen verloren."}
        </p>
        <NoticeBanner notice={notice} />
        <div className="actions">
          <button type="button" className="btn" disabled={busy || !draft.dirty} onClick={draft.discard}>
            Verwerfen
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || !draft.dirty} onClick={() => void onSave()}>
            Für alle Belege speichern
          </button>
        </div>
      </div>
    </aside>
  );
}
