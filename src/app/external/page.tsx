import Link from "next/link";
import { QuoteDemo } from "@/components/quote-demo";
export default function ExternalPage() {
  return <main className="external-page"><Link href="/" className="wordmark">SIAAS Personal /</Link><QuoteDemo /></main>;
}
