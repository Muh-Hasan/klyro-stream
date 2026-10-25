import { PlayIcon } from 'lucide-react';
import Link from 'next/link';
import { PreviewVideoList } from '@/components/screens/home/preview-video-list';
import { AspectRatio } from '@/components/ui/aspect-ratio';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

export default function Home() {
  return (
    <div className="flex min-h-svh flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            KlyroStream
          </Link>
          <nav className="flex items-center gap-2">
            <Button variant="ghost" asChild>
              <Link href="/auth/login">Log in</Link>
            </Button>
            <Button asChild>
              <Link href="/auth/register">Sign up</Link>
            </Button>
          </nav>
        </div>
      </header>
      <main className="flex flex-1 flex-col">
        <section className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-14 px-6 py-16 sm:py-20 lg:grid-cols-[1.15fr_1fr] lg:gap-16">
          <div className="max-w-xl">
            <h1 className="text-4xl leading-[1.1] font-semibold tracking-tight sm:text-5xl lg:text-[3.5rem]">
              Match footage for your club, and nobody else.
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
              Upload full games, watch them in sharp quality on any connection, and share them only
              with the people in your club.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Button size="lg" className="h-11 px-6 text-[15px]" asChild>
                <Link href="/auth/register">Create your club</Link>
              </Button>
              <Button size="lg" variant="outline" className="h-11 px-6 text-[15px]" asChild>
                <Link href="/auth/login">Log in</Link>
              </Button>
            </div>
          </div>
          <Card aria-hidden="true" className="gap-3 rounded-2xl p-3 shadow-2xl shadow-black/40">
            <AspectRatio
              ratio={16 / 9}
              className="flex items-center justify-center overflow-hidden rounded-xl bg-muted"
            >
              <span className="absolute top-3 left-4 text-sm font-medium">
                U16 vs Riverside, second half
              </span>
              <span className="flex size-14 items-center justify-center rounded-full bg-foreground text-background">
                <PlayIcon className="size-6 translate-x-0.5 fill-current" />
              </span>
              <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 px-4 pb-3 text-xs text-muted-foreground tabular-nums">
                <span>24:12</span>
                <Progress value={36} className="flex-1 bg-foreground/15" />
                <span>68:40</span>
                <Badge variant="outline">1080p</Badge>
              </div>
            </AspectRatio>
            <PreviewVideoList />
          </Card>
        </section>
      </main>
      <footer className="border-t">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6 text-xs">
          <span className="font-medium">KlyroStream</span>
          <span className="text-muted-foreground">© 2026 All rights reserved.</span>
        </div>
      </footer>
    </div>
  );
}
