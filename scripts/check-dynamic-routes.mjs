// Garde-fou après `next build` : aucune page admin ni la page Cardinal ne doit
// être prérendue (statique). Une page admin statique figerait au build une
// redirection ou des données, servies ensuite depuis le cache à tout le monde.
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../.next/prerender-manifest.json", import.meta.url), "utf8"));
const prerendered = Object.keys(manifest.routes ?? {});
const MUST_BE_DYNAMIC = ["/", "/historique", "/livraisons/nouvelle", "/parametres", "/recap", "/remboursements", "/soa", "/login"];

const offenders = prerendered.filter((route) => MUST_BE_DYNAMIC.includes(route) || route.startsWith("/p/"));
if (offenders.length > 0) {
  console.error(`Pages prérendues alors qu'elles doivent être dynamiques : ${offenders.join(", ")}`);
  process.exit(1);
}
console.log("OK : aucune page admin ni page Cardinal prérendue.");
