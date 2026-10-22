"use client";
import { useState } from "react";
import { Cloud, Clock3 } from "lucide-react";
import { EXTERNAL_PROVIDER, estimateExternal } from "@/lib/external-quote";
const EXAMPLE_TEXT =
  "The support team responds within two business days. Support is available Monday to Friday.";
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 6,
  maximumFractionDigits: 6,
});
export function QuoteDemo() {
  const [text, setText] = useState(EXAMPLE_TEXT);
  const [quote, setQuote] = useState<ReturnType<
    typeof estimateExternal
  > | null>(null);
  return (
    <div className="delivery-stack quote-demo">
      <section className="panel delivery-panel">
        <div className="delivery-title">
          <Cloud size={24} />
          <div>
            <span className="eyebrow">EXTERNAL PROVIDER · PREVIEW</span>
            <h2>RAG preparation estimate</h2>
          </div>
        </div>
        <p>
          Estimate the cost of embeddings to prepare your text with{" "}
          {EXTERNAL_PROVIDER.name}. This is an estimate only: no external processing or payment.
        </p>
        <label>
          Provider and model
          <input
            value={`${EXTERNAL_PROVIDER.name} · ${EXTERNAL_PROVIDER.model}`}
            disabled
          />
        </label>
        <label>
          Text to estimate
          <textarea
            rows={6}
            maxLength={150000}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setQuote(null);
            }}
          />
        </label>
        <p className="field-help">
          The estimate is calculated in your browser. Text is not saved or sent to the provider. Editing it clears the previous estimate.
        </p>
        <div className="button-row">
          <button
            className="button primary"
            disabled={!text.trim()}
            onClick={() => setQuote(estimateExternal(text))}
          >
            Calculate estimate
          </button>
          <button
            className="button"
            onClick={() => {
              setText(EXAMPLE_TEXT);
              setQuote(null);
            }}
          >
            Restore example
          </button>
        </div>
        {quote && (
          <div className="quote-result" role="status">
            <h3>AI cost estimate only</h3>
            <p>
              {quote.characters.toLocaleString("en-US")} characters · about{" "}
              {quote.lowTokens.toLocaleString("en-US")}–
              {quote.highTokens.toLocaleString("en-US")} token
            </p>
            <strong className="quote-price">
              {usd.format(quote.lowUSD)} – {usd.format(quote.highUSD)}
            </strong>
            <p>
              Initial text indexing only. Excludes subsequent chats, OCR, storage, infrastructure, taxes and service margin. This is not a final purchase price.
            </p>
          </div>
        )}
        <p className="muted small">
          Standard paid rate: USD 0.20 per million text tokens. Assumes 2–4 characters per token, plus 15% for chunk overlap. Actual counts depend on the text. Prices checked on October 2, 2026; free allowances are excluded.{" "}
          <a href={EXTERNAL_PROVIDER.source} target="_blank" rel="noreferrer">
            Official pricing ↗
          </a>
        </p>
      </section>
      <section className="panel delivery-panel">
        <div className="delivery-title">
          <Clock3 size={24} />
          <div>
            <span className="eyebrow">COMING SOON</span>
            <h2>Preparation with an external provider</h2>
          </div>
        </div>
        <p>
          In the future, you will be able to confirm an estimate and prepare the assistant online. This uses RAG: it prepares knowledge without changing model weights.
        </p>
        <button className="button" disabled>
          External preparation · Coming soon
        </button>
      </section>
    </div>
  );
}
