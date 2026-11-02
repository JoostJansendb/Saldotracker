// Nachtmodus: de keuze staat per apparaat in localStorage. "automatisch" volgt de instelling van de telefoon.
export const themePreferences = ["uit", "aan", "automatisch"] as const;
export type ThemePreference = (typeof themePreferences)[number];

const themeStorageKey = "saldo-theme";
const defaultThemePreference: ThemePreference = "uit";
const darkModeQuery = "(prefers-color-scheme: dark)";

// Moet gelijk blijven aan --surface in globals.css: zo krijgt ook de statusbalk op iOS de juiste kleur.
const themeColors = { light: "#f3f4f6", dark: "#0e1219" };

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (themePreferences as readonly string[]).includes(value);
}

// Draait in de <head> nog vóór React, zodat de app in nachtmodus niet eerst wit opflitst.
// Bewust zelfstandige code: dit wordt als tekst in de pagina gezet.
export const themeInitScript = `(function () {
  try {
    var preference = localStorage.getItem(${JSON.stringify(themeStorageKey)});
    var isDark = preference === "aan" || (preference === "automatisch" && window.matchMedia(${JSON.stringify(darkModeQuery)}).matches);
    document.documentElement.classList.toggle("dark", isDark);
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (meta) {
      meta.setAttribute("content", isDark ? ${JSON.stringify(themeColors.dark)} : ${JSON.stringify(themeColors.light)});
    });
  } catch (error) {}
})();`;

// Zonder opslag (privémodus) onthouden we de keuze alleen tot de app opnieuw laadt.
let unsavedPreference: ThemePreference | null = null;

export function getThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(themeStorageKey);
    if (isThemePreference(stored)) return stored;
  } catch {
    // Valt terug op de keuze van deze sessie.
  }
  return unsavedPreference ?? defaultThemePreference;
}

export function getServerThemePreference(): ThemePreference {
  return defaultThemePreference;
}

export function applyThemePreference(preference: ThemePreference) {
  const isDark = preference === "aan" || (preference === "automatisch" && window.matchMedia(darkModeQuery).matches);
  document.documentElement.classList.toggle("dark", isDark);
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.setAttribute("content", isDark ? themeColors.dark : themeColors.light);
  });
}

const listeners = new Set<() => void>();

// Voor useSyncExternalStore. Een keuze in een ander tabblad, of de telefoon die bij "automatisch"
// van licht naar donker gaat, zet het thema meteen om.
export function subscribeToThemePreference(listener: () => void) {
  const media = window.matchMedia(darkModeQuery);
  const handleExternalChange = () => {
    applyThemePreference(getThemePreference());
    listener();
  };
  listeners.add(listener);
  window.addEventListener("storage", handleExternalChange);
  media.addEventListener("change", handleExternalChange);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", handleExternalChange);
    media.removeEventListener("change", handleExternalChange);
  };
}

export function setThemePreference(preference: ThemePreference) {
  unsavedPreference = preference;
  try {
    window.localStorage.setItem(themeStorageKey, preference);
  } catch {
    // Zie unsavedPreference.
  }
  applyThemePreference(preference);
  listeners.forEach((listener) => listener());
}
