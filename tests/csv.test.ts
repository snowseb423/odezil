import { describe, expect, it } from "vitest";
import { monthlySummaries, type SoaStatement } from "@/lib/calculations";
import { deliveriesCsv, monthsCsv, sanitizeText, toCsv, type CsvDelivery } from "@/lib/csv";

function delivery(deliveryDate: string, bottlesA: number, bottlesB: number, note: string | null = null): CsvDelivery {
  return { deliveryDate, bottlesA, bottlesB, unitPriceCentsApplied: 24_000, photoPath: null, note };
}

function lines(csv: string): string[] {
  return csv.replace(/^﻿/, "").trimEnd().split("\r\n");
}

describe("CSV", () => {
  it("BOM UTF-8, séparateur point-virgule, CRLF", () => {
    const csv = toCsv([
      ["a", "b"],
      [1, null],
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toBe("﻿a;b\r\n1;\r\n");
  });

  it("échappe guillemets, points-virgules et retours à la ligne", () => {
    expect(lines(toCsv([['il a dit "oui"; puis\nnon']]))).toEqual(['"il a dit ""oui""; puis\nnon"']);
  });

  it("neutralise les formules dans les notes", () => {
    expect(sanitizeText("=HYPERLINK(\"http://x\")")).toBe("'=HYPERLINK(\"http://x\")");
    expect(sanitizeText("+33")).toBe("'+33");
    expect(sanitizeText("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(sanitizeText("bon n°12")).toBe("bon n°12");
    expect(sanitizeText(null)).toBe("");
  });

  it("export des livraisons, montants en virgule décimale, triés par date", () => {
    const csv = deliveriesCsv([delivery("2026-09-16", 1, 2, "=1+1"), delivery("2026-09-02", 2, 3)]);
    expect(lines(csv)).toEqual([
      "Date;Mois;Bonbonnes Macoua;Bonbonnes Cardinal;Prix unitaire (Rs);Montant Macoua (Rs);Montant Cardinal (Rs);Total (Rs);Photo;Note",
      "02/09/2026;2026-09;2;3;240,00;480,00;720,00;1200,00;non;",
      "16/09/2026;2026-09;1;2;240,00;240,00;480,00;720,00;non;'=1+1",
    ]);
  });

  it("export mensuel avec rapprochement", () => {
    const soas: SoaStatement[] = [
      { month: "2026-09", totalBilledCents: 216_000, varianceCents: 24_000, varianceTreatment: "split_50_50" },
    ];
    const csv = monthsCsv(monthlySummaries([delivery("2026-09-02", 2, 3), delivery("2026-09-16", 1, 2), delivery("2026-10-01", 1, 0)], soas));
    const [header, september, october] = lines(csv);
    expect(header).toContain("Écart enregistré (Rs)");
    expect(september).toBe("2026-09;3;5;720,00;1200,00;1920,00;2160,00;240,00;240,00;partagé 50/50;120,00;1320,00;Écart traité");
    expect(october).toBe("2026-10;1;0;240,00;0,00;240,00;;;;;0,00;0,00;SOA non saisi");
  });
});
