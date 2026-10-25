import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4">
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">KlyroStream</h1>
      <div className="flex gap-3">
        <Button variant="outline" size="lg" asChild>
          <Link href="/login">Log in</Link>
        </Button>
        <Button size="lg" asChild>
          <Link href="/register">Sign up</Link>
        </Button>
      </div>
    </main>
  );
}
