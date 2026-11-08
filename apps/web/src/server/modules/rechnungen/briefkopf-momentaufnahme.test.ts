import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Gestaltung beim Festschreiben (Postgres)", () => {
  let invoices: typeof import("./invoices.ts");
  let quotes: typeof import("./quotes.ts");
  let dunning: typeof import("./dunning.ts");
  let docs: typeof import("./order-documents.ts");
  let stammdaten: typeof import("../stammdaten/index.ts");
  let sql: postgres.Sql;
  let contactId: string;
  const actor = "test-user";
  const png = new Uint8Array(readFileSync(new URL("../../../../public/icon-192.png", import.meta.url)));
  const pngHash = createHash("sha256").update(png).digest("hex");
  const klassisch = { kind: "eingebaut", id: "klassisch" };

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./invoices.ts");
    quotes = await import("./quotes.ts");
    dunning = await import("./dunning.ts");
    docs = await import("./order-documents.ts");
    stammdaten = await import("../stammdaten/index.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate letterhead_profiles, letterhead_logos, company_logo, dunnings, quote_lines, quotes, quote_number_counters, journal_lines,
      journal_entries, invoice_lines, invoices, recurring_invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, bic, bank, dunning)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 123456',
              '198/113/10010', 'DE123456789', 'BY', 'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank',
              '{"baseRate": 127, "fees": {"1": 0, "2": 500, "3": 1000}, "deadlineDays": 10}'::jsonb)`;
    contactId = (
      await stammdaten.createContact(actor, {
        kundennummer: "10001",
        name: "Nordwerk Software GmbH",
        strasse: "Hafenstraße 5",
        plz: "20457",
        ort: "Hamburg",
        land: "DE",
        email: "rechnung@nordwerk.example",
        ustId: "",
        iban: "",
        leitwegId: "",
        defaultFormat: null,
      })
    ).id;
  }, 30_000);

  const invoiceDraft = () =>
    invoices.createDraft(actor, {
      contactId,
      issueDate: "2026-09-01",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Beratung", quantity: 1000, unit: "Psch.", unitPrice: 100_000, taxRate: 1900 }],
    });

  const quoteDraft = () =>
    quotes.createQuoteDraft(actor, {
      contactId,
      issueDate: "2026-09-01",
      validUntil: "2026-09-30",
      serviceFrom: null,
      serviceTo: null,
      note: "",
      lines: [{ description: "Beratung", quantity: 1000, unit: "Std.", unitPrice: 10_000, taxRate: 1900 }],
    });

  const redesign = async () => {
    await stammdaten.saveDesign(actor, { accent: "#9B1C1C", foldMarks: false, customerNumber: false, footerColumns: ["Neue Fußzeile", "{email}"] });
    await stammdaten.removeLogo(actor);
  };

  const same = (a: Uint8Array, b: Uint8Array) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

  it("eine Rechnung merkt sich Layout, Farbe und Logo, ein Entwurf noch nichts", async () => {
    await stammdaten.saveAccentColor(actor, "#0055AA");
    await stammdaten.saveLogo(actor, png);
    const draft = await invoiceDraft();
    expect(draft.design).toBeNull();

    const final = await invoices.finalizeInvoice(actor, draft.id);

    expect(final.design).toMatchObject({ layouts: { rechnung: klassisch, mahnung: klassisch }, accent: "#0055AA", logoSha256: pngHash });
    const [kept] = await sql`select format, logo from letterhead_logos where sha256 = ${pngHash}`;
    expect(kept!.format).toBe("png");
    expect(same(kept!.logo, png)).toBe(true);
  });

  it("ohne Logo steht null in der Momentaufnahme", async () => {
    const final = await invoices.finalizeInvoice(actor, (await invoiceDraft()).id);
    expect(final.design).toMatchObject({ layouts: { rechnung: klassisch, mahnung: klassisch }, accent: "#1F6F5C", logoSha256: null });
    expect(await sql`select 1 from letterhead_logos`).toHaveLength(0);
  });

  it("ein Angebot merkt sich die Gestaltung ebenso", async () => {
    await stammdaten.saveLogo(actor, png);
    const final = await quotes.finalizeQuote(actor, (await quoteDraft()).id);
    expect(final.design).toMatchObject({ layouts: { rechnung: klassisch, mahnung: klassisch }, accent: "#1F6F5C", logoSha256: pngHash });
  });

  it("ist das Logo schon bekannt, bleibt beim zweiten Beleg eine Zeile", async () => {
    await stammdaten.saveLogo(actor, png);
    await invoices.finalizeInvoice(actor, (await invoiceDraft()).id);
    await invoices.finalizeInvoice(actor, (await invoiceDraft()).id);
    expect(await sql`select 1 from letterhead_logos`).toHaveLength(1);
  });

  it("die Mahnung erscheint im Aussehen der Rechnung, auch wenn sich Farbe und Logo geändert haben", async () => {
    await stammdaten.saveAccentColor(actor, "#0055AA");
    await stammdaten.saveLogo(actor, png);
    const { id: invoiceId } = await invoices.finalizeInvoice(actor, (await invoiceDraft()).id);
    const input = { invoiceId, level: 1 as const, dueDate: "2026-10-25", fee: 0, flatFee: false, interest: null, intro: "Bitte zahlen.", closing: "" };
    const before = await dunning.dunningDraftPdf(input, "2026-10-15");
    expect(Buffer.from(before.pdf).toString("latin1")).toContain("/Subtype /Image");

    await redesign();

    expect(same((await dunning.dunningDraftPdf(input, "2026-10-15")).pdf, before.pdf)).toBe(true);
  });

  it("Lieferschein und Auftragsbestätigung bleiben im Aussehen ihres Belegs", async () => {
    await stammdaten.saveAccentColor(actor, "#0055AA");
    const quote = await quotes.finalizeQuote(actor, (await quoteDraft()).id);
    await quotes.setQuoteDecision(actor, quote.id, "angenommen");
    const invoice = await invoices.finalizeInvoice(actor, (await invoiceDraft()).id);
    const confirmation = await docs.confirmationPdf(quote.id);
    const note = await docs.deliveryNotePdf("rechnung", invoice.id);

    await redesign();

    expect(same((await docs.confirmationPdf(quote.id)).pdf, confirmation.pdf)).toBe(true);
    expect(same((await docs.deliveryNotePdf("rechnung", invoice.id)).pdf, note.pdf)).toBe(true);
  });

  it("die Momentaufnahme ist nach dem Festschreiben gesperrt, abgelegte Logos auch", async () => {
    await stammdaten.saveLogo(actor, png);
    const invoice = await invoices.finalizeInvoice(actor, (await invoiceDraft()).id);
    const quote = await quotes.finalizeQuote(actor, (await quoteDraft()).id);

    await expect(sql`update invoices set design = '{"accent": "#000000"}'::jsonb where id = ${invoice.id}`).rejects.toThrow(/festgeschrieben/);
    await expect(sql`update quotes set design = '{"accent": "#000000"}'::jsonb where id = ${quote.id}`).rejects.toThrow(/festgeschrieben/);
    await expect(sql`update letterhead_logos set format = 'jpg'`).rejects.toThrow("darf nur ergänzt werden");
    await expect(sql`delete from letterhead_logos`).rejects.toThrow("darf nur ergänzt werden");
  });

  it("protokolliert ein abgelegtes Logo ohne Bilddaten", async () => {
    await stammdaten.saveLogo(actor, png);
    await invoices.finalizeInvoice(actor, (await invoiceDraft()).id);
    const [log] = await sql`select new_value from audit_log where table_name = 'letterhead_logos'`;
    expect(log!.new_value).toMatchObject({ sha256: pngHash, format: "png" });
    expect(log!.new_value).not.toHaveProperty("logo");
  });
});
