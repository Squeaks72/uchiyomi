'use client';
// Updates is a bubble out of the bell now (components/UpdatesPopover.tsx, 2026-11-18), not a page. An old link or bookmark to /updates/
// lands on home with the bubble open.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { openUpdates } from '@/components/UpdatesPopover';

export default function UpdatesPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/');
    // After home has drawn its bell, so the bubble grows out of it.
    const t = setTimeout(() => openUpdates(), 400);
    return () => clearTimeout(t);
  }, [router]);
  return null;
}
