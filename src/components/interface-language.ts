"use client";
import { useEffect, useState } from "react";

// Match the existing document-language convention; an explicit URL can override it.
export function useInterfaceLanguage() {
  const [italian, setItalian] = useState(false);
  useEffect(() => {
    const update = () => {
      const lang = new URLSearchParams(window.location.search).get("lang");
      if (
        (lang === "it" || lang === "en") &&
        document.documentElement.lang !== lang
      ) {
        document.documentElement.lang = lang;
      }
      setItalian(
        (lang === "it" || lang === "en"
          ? lang
          : document.documentElement.lang
        ).startsWith("it"),
      );
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["lang"],
    });
    window.addEventListener("popstate", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("popstate", update);
    };
  }, []);
  return italian;
}
