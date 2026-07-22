import { NonfictionGalaxy } from "@/components/nonfiction-galaxy";

export const metadata = {
  title: "The Nonfiction Galaxy / The Book Prize Index",
  description: "Explore 6,466 prize-recognized nonfiction books as an interactive semantic map.",
  alternates: { canonical: "/fun/nonfiction-galaxy" },
};

export default function NonfictionGalaxyPage() {
  return <NonfictionGalaxy dataUrl="/fun/nonfiction-galaxy.json" />;
}
