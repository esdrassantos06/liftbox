import Link from "next/link";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { baseOptions } from "@/lib/layout.shared";

const links = [
  ["/docs", "Documentation"],
  ["/docs/quick-start", "Quick start"],
  ["/docs/comparison", "Comparison"],
  ["/", "Home and live demos"],
] as const;

export default function NotFound() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="mx-auto w-full max-w-2xl px-4 py-24 sm:px-6">
        <p className="text-fd-muted-foreground text-sm font-medium">404</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-[-0.03em]">Page not found</h1>
        <p className="text-fd-muted-foreground mt-4">
          Nothing lives at this address. Try one of these pages, or press Ctrl K to search the docs.
        </p>
        <ul className="mt-8 grid gap-2">
          {links.map(([href, text]) => (
            <li key={href}>
              <Link href={href} className="underline underline-offset-4">
                {text}
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </HomeLayout>
  );
}
