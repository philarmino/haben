import { DEFAULT_DESIGN, LAYOUT_DOCUMENT_TYPES, type DesignSnapshot } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Briefkopf und Standardprofil (Postgres)", () => {
  let letterhead: typeof import("./letterhead.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const klassisch = { kind: "eingebaut", id: "klassisch" };

  beforeAll(async () => {
    sql = await setupTestDb();
    letterhead = await import("./letterhead.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate letterhead_profiles, company_logo, company cascade`;
    await sql`insert into company (id, name) values (1, 'Testfirma')`;
  });

  it("gilt ohne Einstellung das Standardgrün, ohne Logo", async () => {
    const head = await letterhead.loadLetterhead();
    expect(head.accent).toBe("#1F6F5C");
    expect(head).not.toHaveProperty("logo");
    expect(head.options).toMatchObject({ logoSize: "m", logoPosition: "rechts", foldMarks: true });
  });

  it("jede Belegart hat ihr eigenes Layout, ab Werk das eingebaute", async () => {
    const { layouts } = await letterhead.loadDesign();
    expect(Object.keys(layouts).sort()).toEqual([...LAYOUT_DOCUMENT_TYPES].sort());
    for (const type of LAYOUT_DOCUMENT_TYPES) expect(layouts[type]).toEqual(klassisch);
  });

  it("speichert die Farbe groß geschrieben im Standardprofil und protokolliert sie", async () => {
    await letterhead.saveAccentColor(actor, "#0055aa");
    expect((await letterhead.loadLetterhead()).accent).toBe("#0055AA");
    const [log] = await sql`select new_value from audit_log where table_name = 'letterhead_profiles' and action = 'INSERT' order by seq desc limit 1`;
    expect(log!.new_value).toMatchObject({ is_default: true, settings: { accent: "#0055AA" } });
  });

  it("legt beim zweiten Speichern kein weiteres Profil an und behält, was die Eingabe nicht nennt", async () => {
    await letterhead.saveDesign(actor, { accent: "#0055AA", logoSize: "l" });
    await letterhead.saveDesign(actor, { foldMarks: false });
    const rows = await sql`select settings from letterhead_profiles`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.settings).toMatchObject({ layouts: { rechnung: klassisch }, accent: "#0055AA", logoSize: "l", foldMarks: false, giroCode: true });
  });

  it("übergibt Logo und Schalter an das PDF", async () => {
    await letterhead.saveDesign(actor, { logoSize: "s", logoPosition: "links", giroCode: false });
    expect((await letterhead.loadLetterhead()).options).toMatchObject({ logoSize: "s", logoPosition: "links", giroCode: false, customerNumber: true });
  });

  it("erlaubt nur ein Standardprofil", async () => {
    await letterhead.saveAccentColor(actor, "#0055AA");
    await expect(sql`insert into letterhead_profiles (name, is_default, settings) values ('Zweites', true, '{"accent": "#000000"}'::jsonb)`).rejects.toThrow(
      /letterhead_profiles_default/,
    );
  });

  it("lehnt alles außer #RRGGBB ab, auch direkt in der Datenbank", async () => {
    for (const color of ["blue", "#05A", "#0055AAFF", "0055AA", '#00"); panic('])
      await expect(letterhead.saveAccentColor(actor, color)).rejects.toThrow(/#RRGGBB/);
    await expect(sql`insert into letterhead_profiles (name, settings) values ('Kaputt', '{"accent": "rot"}'::jsonb)`).rejects.toThrow(
      /letterhead_profiles_accent/,
    );
  });

  it("lehnt unbekannte Werte ab und ändert dann nichts", async () => {
    await expect(letterhead.saveDesign(actor, { logoSize: "xl" as "l" })).rejects.toThrow(/ungültig/);
    expect(await sql`select 1 from letterhead_profiles`).toHaveLength(0);
  });

  it("speichert eine eigene Fußzeile und lehnt unbekannte Platzhalter ab", async () => {
    await letterhead.saveDesign(actor, { footerColumns: ["{firma}", "{email}"] });
    expect((await letterhead.loadLetterhead()).options?.footerColumns).toEqual(["{firma}", "{email}"]);
    await expect(letterhead.saveDesign(actor, { footerColumns: ["{fax}", "{email}"] })).rejects.toThrow(/ungültig/);
    await letterhead.saveDesign(actor, { footerColumns: null });
    expect((await letterhead.loadLetterhead()).options?.footerColumns).toBeNull();
  });

  it("ohne Momentaufnahme (ältere Belege) gilt der aktuelle Briefkopf", async () => {
    await letterhead.saveAccentColor(actor, "#0055AA");
    expect(await letterhead.letterheadOf(null)).toEqual(await letterhead.loadLetterhead());
  });

  it("mit Momentaufnahme gilt deren Gestaltung, ein fehlendes Logo bleibt weg", async () => {
    await letterhead.saveDesign(actor, { accent: "#0055AA", logoSize: "l" });
    const snapshot: DesignSnapshot = { ...DEFAULT_DESIGN, accent: "#9B1C1C", logoSize: "s", logoSha256: null };
    const head = await letterhead.letterheadOf(snapshot);
    expect(head).toMatchObject({ accent: "#9B1C1C", options: { logoSize: "s" } });
    expect(head).not.toHaveProperty("logo");
  });

  it("eine Momentaufnahme von früher bekommt für neue Einstellungen die Vorgaben", async () => {
    const older = { accent: "#9B1C1C", logoSha256: null } as DesignSnapshot;
    expect((await letterhead.letterheadOf(older)).options).toMatchObject({ logoSize: "m", vatColumn: true });
  });
});
