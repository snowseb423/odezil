import type { Metadata } from "next";

/**
 * Métadonnées PWA (manifest, icône iOS), ajoutées aux pages admin et à la page
 * de connexion uniquement : la page Cardinal (/p/...) n'est pas l'application.
 */
export const pwaMetadata: Metadata = {
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "EauPartagée", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};
