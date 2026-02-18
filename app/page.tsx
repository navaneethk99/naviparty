export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center px-6">
      <div className="max-w-xl text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Teleparty Sync Backend</h1>
        <p className="mt-3 text-base text-zinc-300">
          WebSocket endpoint: <span className="font-mono">/ws</span>
        </p>
        <p className="mt-2 text-sm text-zinc-400">
          Use the Chrome extension to join rooms and sync playback.
        </p>
      </div>
    </main>
  );
}
