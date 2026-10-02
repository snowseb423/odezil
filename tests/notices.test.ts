import { describe, expect, it } from "vitest";
import { noticeFor } from "@/lib/notices";

describe("messages de confirmation (?ok=…)", () => {
  it("renvoie le message des clés connues", () => {
    expect(noticeFor("livraison")).toBe("Livraison enregistrée.");
    expect(noticeFor("soa")).toBe("Relevé SOA enregistré.");
    expect(noticeFor("remboursement")).toBe("Remboursement enregistré.");
  });

  it.each(["constructor", "__proto__", "toString", "hasOwnProperty", "inconnu", ""])(
    "ignore « %s » (pas de plantage du rendu)",
    (key) => {
      expect(noticeFor(key)).toBeUndefined();
    },
  );

  it("ignore les valeurs multiples ou absentes", () => {
    expect(noticeFor(["livraison", "soa"])).toBeUndefined();
    expect(noticeFor(undefined)).toBeUndefined();
  });
});
