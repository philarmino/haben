import { designWithDefaults, letterheadDesignInputSchema, type DesignSnapshot, type LetterheadDesign, type LetterheadDesignInput } from "@haben/core";
import type { Letterhead, Logo } from "@haben/einvoice";
import { eq, sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { keepLogo, loadKeptLogo, loadLogo, logoHash } from "./logo.ts";

/** Briefkopf von Rechnungen, Angeboten und Mahnungen: Gestaltung aus dem Standardprofil, dazu das Logo */

export class AccentColorError extends UserError {}

/** Ohne gespeichertes Profil gelten die Vorgaben; Einstellungen, die eine ältere Zeile nicht kennt, ebenso */
export async function loadDesign(q: Db | Tx = db): Promise<LetterheadDesign> {
  const profiles = schema.letterheadProfiles;
  const [row] = await q.select({ settings: profiles.settings }).from(profiles).where(eq(profiles.isDefault, true));
  return designWithDefaults(row?.settings);
}

function letterheadFrom(design: LetterheadDesign, logo: Logo | undefined): Letterhead {
  const { accent, logoSize, logoPosition, foldMarks, giroCode, customerNumber, vatColumn, footerColumns } = design;
  return { accent, options: { logoSize, logoPosition, foldMarks, giroCode, customerNumber, vatColumn, footerColumns }, ...(logo ? { logo } : {}) };
}

export interface DocumentLook {
  letterhead: Letterhead;
  snapshot: DesignSnapshot;
}

/** Heutige Gestaltung für einen neuen Beleg, zum Rendern und als Momentaufnahme. Schreibt nichts: Das Rendern hält die Hash-Kette nicht auf */
export async function currentLook(): Promise<DocumentLook> {
  const [logo, design] = await Promise.all([loadLogo(), loadDesign()]);
  return { letterhead: letterheadFrom(design, logo), snapshot: { ...design, logoSha256: logo ? logoHash(logo) : null } };
}

/** Beim Festschreiben, nach dem Rendern: Das Logo der Momentaufnahme bleibt, auch wenn das Firmenlogo wechselt */
export async function keepLook(tx: Tx, { letterhead, snapshot }: DocumentLook): Promise<void> {
  if (letterhead.logo && snapshot.logoSha256) await keepLogo(tx, snapshot.logoSha256, letterhead.logo);
}

/** Logo, Farbe und Schalter für ein neues PDF; schon festgeschriebene Belege behalten ihr PDF */
export async function loadLetterhead(): Promise<Letterhead> {
  return (await currentLook()).letterhead;
}

/** Briefkopf für das Folgedokument eines festgeschriebenen Belegs; ältere Belege haben keine Momentaufnahme und bekommen den heutigen */
export async function letterheadOf(snapshot: DesignSnapshot | null, q: Db | Tx = db): Promise<Letterhead> {
  if (!snapshot) return loadLetterhead();
  return letterheadFrom(designWithDefaults(snapshot), snapshot.logoSha256 ? await loadKeptLogo(snapshot.logoSha256, q) : undefined);
}

/** Ändert das Standardprofil; was die Eingabe nicht nennt, bleibt. Farben werden groß geschrieben gespeichert */
export async function saveDesign(actor: string, input: LetterheadDesignInput): Promise<LetterheadDesign> {
  const parsed = letterheadDesignInputSchema.safeParse(input);
  if (!parsed.success) throw new AccentColorError("Die Gestaltung ist ungültig. Die Akzentfarbe hat die Form #RRGGBB, z. B. #1F6F5C.");
  return withActor(actor, async (tx) => {
    const changes = parsed.data.accent ? { ...parsed.data, accent: parsed.data.accent.toUpperCase() } : parsed.data;
    const settings = { ...(await loadDesign(tx)), ...changes };
    await tx
      .insert(schema.letterheadProfiles)
      .values({ name: "Standard", isDefault: true, settings })
      .onConflictDoUpdate({
        target: schema.letterheadProfiles.isDefault,
        targetWhere: sql`${schema.letterheadProfiles.isDefault}`,
        set: { settings, updatedAt: new Date() },
      });
    return settings;
  });
}

export async function saveAccentColor(actor: string, color: string): Promise<void> {
  await saveDesign(actor, { accent: color });
}
