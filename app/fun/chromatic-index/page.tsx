import rawCoverSpectrum from "@/data/public/cover-spectrum.json";
import { ChromaticIndex } from "@/components/chromatic-index";
import type { CoverSpectrumData } from "@/lib/cover-spectrum-types";

export const metadata = {
  title: "The Chromatic Index / The Book Prize Index",
  description: "Thousands of nonfiction book covers arranged by hue and brightness.",
};

export default function ChromaticIndexPage() {
  return (
    <main className="chromatic-index-page">
      <ChromaticIndex data={rawCoverSpectrum as CoverSpectrumData} />
    </main>
  );
}
