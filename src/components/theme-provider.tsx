"use client";

import { ThemeProvider as NextThemes } from "next-themes";

export function ThemeProvider(props: React.ComponentProps<typeof NextThemes>) {
  return <NextThemes {...props} />;
}
