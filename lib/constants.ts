// Shared frontend constants (D22.4).
// Keep values that mirror backend behavior here so the UI stays in lockstep.

// Touch target / sizing standards (D21.3, D22.3).
export const MIN_TOUCH_TARGET = 44; // px, mobile/tablet
export const MIN_POINTER_TARGET = 40; // px, desktop
export const MOBILE_TAB_BAR_HEIGHT = 64; // px
export const TABLET_RAIL_WIDTH = 72; // px
export const DESKTOP_SIDEBAR_WIDTH = 240; // px
export const DESKTOP_BREAKPOINT = 1200; // px
export const TABLET_BREAKPOINT = 768; // px

// Sign-in form (mirrors lib/auth.ts emailAndPassword config).
export const MIN_PASSWORD_LENGTH = 8;

// Money: wire values are rupees (D11); the domain operates on whole paisa.
// The ERP is for Nepal: currency is the Nepali rupee (NPR), rendered with the
// रू symbol and the ne-NP locale (Latin digits, South Asian lakh/crore
// grouping).
export const CURRENCY_CODE = "NPR";
export const CURRENCY_LOCALE = "ne-NP";
export const CURRENCY_SYMBOL = "रू";

// Shop identity shown on the sign-in screen until real settings exist.
export const APP_NAME = "ERP Retail";
