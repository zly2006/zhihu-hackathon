import { RestartLife } from "@/components/restart-life";
import { getDatabaseStats } from "@/lib/database";

export const dynamic = "force-dynamic";

export default async function Home() {
  const stats = await getDatabaseStats();
  return <RestartLife stats={stats} />;
}
