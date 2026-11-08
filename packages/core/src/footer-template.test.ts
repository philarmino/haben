import { describe, expect, it } from "vitest";
import { customFooter, DEFAULT_FOOTER_COLUMNS, fillFooterColumn, footerIssues, footerValues, MAX_FOOTER_LINES } from "./footer-template.ts";

const seller = {
  name: "Testfirma",
  strasse: "Musterstraße 1",
  plz: "93047",
  ort: "Regensburg",
  email: "rechnung@example.com",
  iban: "DE89370400440532013000",
  steuernummer: "198/113/10010",
};
const values = footerValues(seller);
const labels = { taxNumber: "Steuernummer", vatId: "USt-IdNr." };

describe("Eigene Fußzeile", () => {
  it("setzt Werte ein und lässt Text stehen", () => {
    expect(fillFooterColumn("{firma}\n{plz} {ort}\nGeprüft", values)).toEqual(["Testfirma", "93047 Regensburg", "Geprüft"]);
  });

  it("lässt eine Zeile weg, wenn ihr Wert fehlt", () => {
    expect(fillFooterColumn("Telefon {telefon}\nBIC {bic}\n{email}", values)).toEqual(["rechnung@example.com"]);
  });

  it("der Kontoinhaber ist ohne eigene Angabe die Firma", () => {
    expect(values.kontoinhaber).toBe("Testfirma");
  });

  it("die Vorgabe hat nur bekannte Platzhalter", () => {
    expect(footerIssues(DEFAULT_FOOTER_COLUMNS)).toEqual([]);
  });

  it("meldet unbekannte Platzhalter und zu viele Zeilen", () => {
    expect(footerIssues(["{fax}", "{firma}"])[0]).toContain("{fax}");
    expect(footerIssues(["x\n".repeat(MAX_FOOTER_LINES).concat("y"), "z"])).toHaveLength(1);
  });

  it("ergänzt die Steuernummer, wenn die Spalten sie nicht nennen (§ 14 Abs. 4 Nr. 2 UStG)", () => {
    expect(customFooter(["{firma}", "{iban}"], values, labels)).toEqual([["Testfirma"], ["DE89370400440532013000", "Steuernummer 198/113/10010"]]);
  });

  it("ergänzt nichts, wenn Steuernummer oder USt-IdNr. schon dasteht", () => {
    expect(customFooter(["{firma}", "St.-Nr. {steuernummer}"], values, labels)[1]).toEqual(["St.-Nr. 198/113/10010"]);
    const nurUstId = footerValues({ ...seller, steuernummer: "", ustId: "DE123456789" });
    expect(customFooter(["{firma}", "VAT {ustid}"], nurUstId, labels)[1]).toEqual(["VAT DE123456789"]);
  });

  it("nimmt die USt-IdNr., wenn es keine Steuernummer gibt", () => {
    const nurUstId = footerValues({ ...seller, steuernummer: "", ustId: "DE123456789" });
    expect(customFooter(["{firma}", "{email}"], nurUstId, labels)[1]).toEqual(["rechnung@example.com", "USt-IdNr. DE123456789"]);
  });
});
