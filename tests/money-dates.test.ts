import { describe, expect, it } from "vitest";
import {
  addMonths,
  formatDateFr,
  formatDateShortFr,
  formatMonthFr,
  formatMonthFrCapitalized,
  formatOfMonthFr,
  isIsoDate,
  isMonthKey,
  monthKeyOf,
  monthStartDate,
  todayIso,
} from "@/lib/dates";
import {
  centsToInputValue,
  formatCentsDecimal,
  formatRs,
  formatRsSigned,
  parseRsToCents,
  sumCents,
} from "@/lib/money";

const NBSP = " ";

describe("formatRs", () => {
  it.each([
    [0, "Rs 0,00"],
    [5, "Rs 0,05"],
    [24_000, "Rs 240,00"],
    [120_000, "Rs 1 200,00"],
    [123_456_789, "Rs 1 234 567,89"],
    [-120_050, "-Rs 1 200,50"],
  ])("%i → %s", (cents, expected) => {
    expect(formatRs(cents)).toBe(expected.replaceAll(" ", NBSP));
  });

  it("utilise des espaces insécables", () => {
    expect(formatRs(120_000)).not.toContain(" ");
  });

  it("signe explicite pour les écarts", () => {
    expect(formatRsSigned(500)).toBe(`+Rs${NBSP}5,00`);
    expect(formatRsSigned(-500)).toBe(`-Rs${NBSP}5,00`);
    expect(formatRsSigned(0)).toBe(`Rs${NBSP}0,00`);
  });

  it("refuse un montant non entier", () => {
    expect(() => formatRs(1.5)).toThrow();
  });
});

describe("formats numériques", () => {
  it("décimal sans milliers (CSV)", () => {
    expect(formatCentsDecimal(123_456)).toBe("1234,56");
    expect(formatCentsDecimal(-5)).toBe("-0,05");
  });

  it("valeur de champ de saisie", () => {
    expect(centsToInputValue(24_000)).toBe("240");
    expect(centsToInputValue(24_050)).toBe("240,50");
  });
});

describe("parseRsToCents", () => {
  it.each([
    ["240", 24_000],
    ["240,5", 24_050],
    ["240,50", 24_050],
    ["240.50", 24_050],
    ["1 200,00", 120_000],
    [`1${NBSP}200,00`, 120_000],
    ["1 200", 120_000],
    ["Rs 1 200", 120_000],
    ["rs240", 24_000],
    ["  0,01 ", 1],
    ["0", 0],
    ["007", 700],
  ])("%s → %i", (input, expected) => {
    expect(parseRsToCents(input)).toBe(expected);
  });

  it("convertit sans erreur de flottant", () => {
    // 19.99 * 100 = 1998.9999999999998 en flottant.
    expect(parseRsToCents("19,99")).toBe(1_999);
    expect(parseRsToCents("0,29")).toBe(29);
    expect(parseRsToCents("1,15")).toBe(115);
    expect(parseRsToCents("4,35")).toBe(435);
  });

  it.each(["", " ", "abc", "-240", "240,505", "1.200,00", "1,200.00", "12e3", "Infinity", "240,", ",5", "99999999999"])(
    "refuse %s",
    (input) => {
      expect(parseRsToCents(input)).toBeNull();
    },
  );

  it("refuse au-delà de l'entier SQL", () => {
    expect(parseRsToCents("21474836,47")).toBe(2_147_483_647);
    expect(parseRsToCents("21474836,48")).toBeNull();
  });
});

describe("sumCents", () => {
  it("additionne des entiers", () => {
    expect(sumCents([1, 2, 3])).toBe(6);
    expect(sumCents([])).toBe(0);
  });

  it("refuse un flottant", () => {
    expect(() => sumCents([1, 0.5])).toThrow();
  });
});

describe("dates", () => {
  it("valide les dates ISO", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-1-01")).toBe(false);
    expect(isIsoDate("2026-04-31")).toBe(false);
  });

  it("valide les mois", () => {
    expect(isMonthKey("2026-09")).toBe(true);
    expect(isMonthKey("2026-00")).toBe(false);
    expect(isMonthKey("2026-9")).toBe(false);
  });

  it("aujourd'hui dans le fuseau de Maurice (UTC+4)", () => {
    // 21:30 UTC le 30 septembre = 01:30 le 1er octobre à Maurice.
    expect(todayIso(new Date("2026-09-30T21:30:00Z"))).toBe("2026-10-01");
    expect(todayIso(new Date("2026-09-30T19:59:00Z"))).toBe("2026-09-30");
  });

  it("mois d'une date et premier jour du mois", () => {
    expect(monthKeyOf("2026-09-14")).toBe("2026-09");
    expect(monthStartDate("2026-09")).toBe("2026-09-01");
    expect(() => monthKeyOf("2026-09")).toThrow();
  });

  it("décale les mois en franchissant les années", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2025-12", 1)).toBe("2026-01");
    expect(addMonths("2026-09", -21)).toBe("2024-12");
  });

  it("libellés français", () => {
    expect(formatMonthFr("2026-08")).toBe("août 2026");
    expect(formatMonthFrCapitalized("2026-02")).toBe("Février 2026");
    expect(formatDateFr("2026-09-01")).toBe("1er septembre 2026");
    expect(formatDateFr("2026-09-14")).toBe("14 septembre 2026");
    expect(formatDateShortFr("2026-09-04")).toBe("04/09/2026");
    expect(formatOfMonthFr("2026-09")).toBe("de septembre 2026");
    expect(formatOfMonthFr("2026-08")).toBe("d'août 2026");
    expect(formatOfMonthFr("2026-04")).toBe("d'avril 2026");
    expect(formatOfMonthFr("2026-10")).toBe("d'octobre 2026");
    expect(formatOfMonthFr("2026-01")).toBe("de janvier 2026");
  });
});
