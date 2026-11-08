import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { SESSION } from "./daten.ts";
import { HANDY } from "./kopfzeile.ts";

/**
 * Gestaltung der Belege (#113): Zahnrad in der Vorschau, Spalte neben dem Blatt, Speichern für alle künftigen Belege.
 * Mit der Sitzung aus app.spec.ts (Projekt „mit-daten“). Die Tests setzen die Gestaltung am Ende zurück.
 */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const SCHMAL = { width: 1400, height: 800 };
const BREIT = { width: 1920, height: 1080 };

async function editor(browser: Browser, viewport: { width: number; height: number }, mode: "angeheftet" | "ueberblendung" = "ueberblendung"): Promise<Page> {
  const state = JSON.parse(readFileSync(SESSION, "utf8")) as {
    cookies: [];
    origins: { origin: string; localStorage: { name: string; value: string }[] }[];
  };
  const origins = state.origins.map((o) => ({
    ...o,
    localStorage: [...o.localStorage.filter((item) => item.name !== "haben-vorschau"), { name: "haben-vorschau", value: mode }],
  }));
  const page = await (await browser.newContext({ viewport, storageState: { ...state, origins } })).newPage();
  await page.goto("/rechnungen/neu");
  await page.waitForLoadState("networkidle");
  return page;
}

const head = (p: Page) => p.locator(".main > .page-head");
const vorschauKnopf = (p: Page) => head(p).getByRole("button", { name: "Vorschau", exact: true });
const seitenansicht = (p: Page) => p.getByRole("region", { name: "Vorschau", exact: true });
const dialog = (p: Page) => p.getByRole("dialog", { name: "Vorschau" });
const panel = (p: Page) => dialog(p).getByRole("complementary", { name: "Gestaltung" });
const blatt = (p: Page) => dialog(p).getByLabel("Vorschau der Rechnung");
const brand = (p: Page) => blatt(p).evaluate((el) => getComputedStyle(el).getPropertyValue("--brand").trim());

async function gestaltungOeffnen(p: Page): Promise<void> {
  await vorschauKnopf(p).click();
  await dialog(p).getByRole("button", { name: "Gestaltung" }).click();
  await expect(panel(p)).toBeVisible();
}

test("Die Knöpfe der angehefteten Vorschau stehen rechts, auch wenn sie in die zweite Zeile rutschen", async ({ browser }) => {
  const page = await editor(browser, SCHMAL, "angeheftet");
  const kopf = await page.locator(".preview-pane-head").boundingBox();
  const knoepfe = await page.locator(".preview-pane-actions").boundingBox();
  expect(knoepfe!.x + knoepfe!.width).toBeCloseTo(kopf!.x + kopf!.width, 0);
  await page.context().close();
});

test("Die Spalte Gestaltung zeigt Änderungen sofort und verwirft sie", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await gestaltungOeffnen(page);
  const vorher = await brand(page);

  await panel(page).getByRole("button", { name: "Blau" }).click();
  await expect.poll(() => brand(page)).toBe("#1D4E89");
  await expect(panel(page).getByRole("button", { name: "Für alle Belege speichern" })).toBeEnabled();

  await panel(page).getByRole("button", { name: "Verwerfen" }).click();
  await expect.poll(() => brand(page)).toBe(vorher);
  await expect(panel(page).getByRole("button", { name: "Für alle Belege speichern" })).toBeDisabled();
  await page.context().close();
});

test("Die Farbkreise stehen nebeneinander, auch mit den Stilen der Auswertungen", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await page.addStyleTag({ content: readFileSync("src/styles/auswertungen.css", "utf8") });
  await gestaltungOeffnen(page);
  const blau = await panel(page).getByRole("button", { name: "Blau" }).boundingBox();
  const gruen = await panel(page).getByRole("button", { name: "Grün" }).boundingBox();
  expect(blau!.width).toBe(44);
  expect(blau!.x).toBeGreaterThanOrEqual(gruen!.x + gruen!.width);
  await page.context().close();
});

test("Der Link zu den Einstellungen öffnet einen neuen Tab, das Formular bleibt", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await gestaltungOeffnen(page);
  const [tab] = await Promise.all([
    page.context().waitForEvent("page"),
    panel(page)
      .getByRole("link", { name: /neuer Tab/ })
      .click(),
  ]);
  await expect(tab).toHaveURL(/bereich=gestaltung/);
  await expect(panel(page)).toBeVisible();
  await page.context().close();
});

test("Schalter wirken auf das Blatt", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await gestaltungOeffnen(page);
  await expect(blatt(page).locator(".sheet-fold").first()).toBeAttached();
  await panel(page).getByLabel("Falz- und Lochmarken").uncheck();
  await expect(blatt(page).locator(".sheet-fold")).toHaveCount(0);
  await page.context().close();
});

test("Die Spalte USt entfällt nur bei einem einzigen Steuersatz, sonst sagt das Panel warum", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await page.getByLabel("Beschreibung Position 1").fill("Beratung");
  await page.getByLabel("Menge Position 1").fill("2");
  await page.getByLabel(/Einzelpreis Position 1/).fill("10,00");
  await page.getByRole("button", { name: "Position hinzufügen" }).click();
  await page.getByLabel("Beschreibung Position 2").fill("Fachbuch");
  await page.getByLabel("Menge Position 2").fill("1");
  await page.getByLabel(/Einzelpreis Position 2/).fill("39,00");
  await page.getByLabel("Steuersatz Position 2").selectOption("700");
  await gestaltungOeffnen(page);
  const spalte = blatt(page).locator("th", { hasText: "USt" });
  await panel(page).getByLabel("Spalte USt je Position").uncheck();
  await expect(spalte).toHaveCount(1);
  await expect(panel(page).getByRole("status")).toContainText("mehrere Steuersätze");
  await page.context().close();
});

test("Schließen verwirft ungespeicherte Änderungen, die Vorschau zeigt wieder das, was das PDF zeigt", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await gestaltungOeffnen(page);
  const vorher = await brand(page);
  await panel(page).getByRole("button", { name: "Rot" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
  await vorschauKnopf(page).click();
  await expect.poll(() => brand(page)).toBe(vorher);
  await page.context().close();
});

test("Speichern gilt nach dem Neuladen und lässt das Formular stehen", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await page.getByLabel("Beschreibung Position 1").fill("Eingabe bleibt");
  await gestaltungOeffnen(page);
  const vorher = await brand(page);

  await panel(page).getByRole("button", { name: "Violett" }).click();
  await panel(page).getByRole("button", { name: "Für alle Belege speichern" }).click();
  await expect(panel(page).getByRole("status")).toContainText("Gespeichert");
  await dialog(page).getByRole("button", { name: "Schließen" }).click();
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("Eingabe bleibt");

  await page.reload();
  await page.waitForLoadState("networkidle");
  await gestaltungOeffnen(page);
  expect(await brand(page)).toBe("#6B3FA0");

  await page.goto("/einstellungen?bereich=gestaltung");
  await page.waitForLoadState("networkidle");
  const akzent = page.getByRole("form", { name: "Akzentfarbe" });
  await akzent.getByLabel("Hex-Wert").fill(vorher.toUpperCase());
  await akzent.getByRole("button", { name: "Übernehmen" }).click();
  await expect(akzent.getByRole("status")).toContainText("Akzentfarbe gespeichert.");
  await page.context().close();
});

test("Das Zahnrad der angehefteten Vorschau öffnet die Überblendung mit der Spalte", async ({ browser }) => {
  const page = await editor(browser, BREIT, "angeheftet");
  await seitenansicht(page).getByRole("button", { name: "Gestaltung" }).click();
  await expect(panel(page)).toBeVisible();
  await page.context().close();
});

test("Am Handy stehen Blatt und Gestaltung untereinander, ohne seitliches Scrollen", async ({ browser }) => {
  const page = await editor(browser, HANDY);
  await gestaltungOeffnen(page);
  const breite = await page.evaluate(() => document.querySelector("dialog")!.scrollWidth - document.querySelector("dialog")!.clientWidth);
  expect(breite).toBe(0);
  await page.context().close();
});

test("Die Einstellungen nennen je Belegart das eingebaute Layout", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await page.goto("/einstellungen?bereich=gestaltung");
  await page.waitForLoadState("networkidle");
  const karte = page.getByRole("region", { name: "Layouts" });
  await expect(karte.getByRole("row")).toHaveCount(6);
  await expect(karte.getByRole("row", { name: /Mahnung/ })).toContainText("Klassisch");
  await expect(karte.getByRole("row", { name: /Mahnung/ })).toContainText("Eingebaut");
  await page.context().close();
});

test("Spalte Gestaltung ohne Befund von axe", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await gestaltungOeffnen(page);
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
  await page.context().close();
});

test("Eigene Fußzeile: Platzhalter, Prüfung und Übernahme aufs Blatt", async ({ browser }) => {
  const page = await editor(browser, BREIT);
  await page.goto("/einstellungen?bereich=gestaltung");
  await page.waitForLoadState("networkidle");
  const karte = page.getByRole("region", { name: "Fußzeile" });
  await karte.getByLabel("Eigene Fußzeile").check();
  await karte.getByRole("button", { name: "4 Spalten" }).click();

  await karte.getByLabel("Spalte 4").fill("{fax}");
  await expect(karte.getByRole("alert")).toContainText("{fax}");
  await expect(karte.getByRole("button", { name: "Fußzeile speichern" })).toBeDisabled();

  await karte.getByLabel("Spalte 4").fill("Sprechzeiten Mo bis Fr ");
  await karte.getByRole("button", { name: "{email}" }).click();
  await expect(karte.getByLabel("Spalte 4")).toHaveValue(/\{email\}/);
  await karte.getByRole("button", { name: "Fußzeile speichern" }).click();
  await expect(karte.getByRole("status").last()).toContainText("Fußzeile gespeichert");

  await page.goto("/rechnungen/neu");
  await page.waitForLoadState("networkidle");
  await vorschauKnopf(page).click();
  await expect(blatt(page).locator(".sheet-foot")).toContainText("Sprechzeiten Mo bis Fr");

  await page.goto("/einstellungen?bereich=gestaltung");
  await page.waitForLoadState("networkidle");
  await karte.getByLabel("Eigene Fußzeile").uncheck();
  await karte.getByRole("button", { name: "Fußzeile speichern" }).click();
  await expect(karte.getByRole("status").last()).toContainText("Fußzeile gespeichert");
  await page.context().close();
});
