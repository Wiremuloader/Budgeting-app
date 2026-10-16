import type { Metadata } from "next";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage() {
  return <SignUpForm requireVerification={process.env.REQUIRE_EMAIL_VERIFICATION === "true"} />;
}

// Reads REQUIRE_EMAIL_VERIFICATION at request time, not build time.
export const dynamic = "force-dynamic";
