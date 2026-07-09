import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <h1 className="font-display text-4xl font-bold text-ink">
        PPCRV Election Results
      </h1>
      <p className="mt-2 text-lg text-gray-600">
        Philippine election monitoring platform
      </p>
      <Link
        href="/results"
        className="mt-8 rounded bg-ink px-6 py-3 font-semibold uppercase tracking-wider text-ballot hover:opacity-90"
      >
        View Results
      </Link>
    </div>
  );
}
