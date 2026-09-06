import { LifeApp } from "@/components/life/LifeApp";
import { ZhaoLengDemo } from "@/components/life/ZhaoLengDemo";

export const dynamic = "force-dynamic";

export default async function LifePage({
  searchParams,
}: {
  searchParams?: Promise<{ demo?: string | string[] }>;
}) {
  const params = (await searchParams) ?? {};
  return params.demo === "zhao-leng" ? <ZhaoLengDemo /> : <LifeApp />;
}
