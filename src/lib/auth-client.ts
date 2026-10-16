"use client";

import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [
    twoFactorClient({
      // The sign-in form reads `twoFactorRedirect` from the response and shows the code step itself.
      onTwoFactorRedirect() {},
    }),
  ],
});
