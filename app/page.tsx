import { ExplorerHome } from "@/components/explorer-home";
import { data } from "@/lib/data";
import { Suspense } from "react";

export default function Home() {
  return (
    <Suspense fallback={null}>
      <ExplorerHome data={data} />
    </Suspense>
  );
}
