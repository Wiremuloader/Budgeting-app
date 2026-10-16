import Link from "next/link";
import { Logo } from "@/components/logo";
import { buttonStyles } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <Logo className="justify-center" />
        <h1 className="mt-8 font-display text-5xl tracking-tight">Page not found</h1>
        <p className="mt-3 text-muted">That page doesn’t exist or has moved.</p>
        <Link href="/overview" className={buttonStyles({ variant: "primary", className: "mt-6" })}>
          Back to overview
        </Link>
      </div>
    </main>
  );
}
