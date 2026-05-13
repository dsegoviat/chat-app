import type { ApiStatusResponse } from "@chat-app/contracts";

import { Button } from "@/components/ui/button";

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:4000";

async function getStatus(): Promise<ApiStatusResponse> {
  const response = await fetch(`${apiBaseUrl}/api/status`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("Failed to reach API Application");
  }

  return (await response.json()) as ApiStatusResponse;
}

export default async function HomePage() {
  const status = await getStatus();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center gap-6 px-6">
      <div className="space-y-2">
        <p className="text-sm uppercase tracking-widest text-neutral-500">
          Turborepo Foundation
        </p>
        <h1 className="text-3xl font-semibold">UI Application is connected</h1>
        <p className="text-neutral-600">
          API service: <strong>{status.service}</strong> | status: <strong>{status.status}</strong>
        </p>
        <p className="text-neutral-600">Server timestamp: {status.timestamp}</p>
      </div>
      <div>
        <Button variant="outline">shadcn/ui is configured</Button>
      </div>
    </main>
  );
}
