import type { ComponentProps } from "react";
import type { ClerkProvider } from "@clerk/nextjs";

// Themes Clerk's prebuilt <SignIn/>/<SignUp/>/<UserButton/> to match this
// app's existing light-only design system (src/app/globals.css) instead of
// Clerk's own defaults, mapping onto the same CSS custom properties the
// Button/Card components already read from.
export const clerkAppearance: ComponentProps<typeof ClerkProvider>["appearance"] = {
  // Required for Tailwind v4 (see globals.css's `@import "tailwindcss"`) so
  // Clerk's own styles don't fight utility classes in the cascade.
  cssLayerName: "clerk",
  variables: {
    colorPrimary: "var(--primary)",
    colorPrimaryForeground: "var(--primary-foreground)",
    colorBackground: "var(--card)",
    colorForeground: "var(--card-foreground)",
    colorMuted: "var(--muted)",
    colorMutedForeground: "var(--muted-foreground)",
    colorInput: "var(--input)",
    colorInputForeground: "var(--foreground)",
    colorDanger: "var(--destructive)",
    colorBorder: "var(--border)",
    colorRing: "var(--ring)",
    colorNeutral: "var(--border)",
    borderRadius: "var(--radius)",
    fontFamily: "var(--font-body)",
    fontFamilyMono: "var(--font-code)",
  },
};
