import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LICENSE_DOCUMENTS, readLicenseDocuments } from "../src/lib/licenses";
import { AboutSettings } from "../src/components/about-settings";

test("integrated license texts match verified upstream artifacts and SIAAS stays MIT", async () => {
  const hash = async (path: string) =>
    createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
  assert.equal(
    await hash("services/laya/LICENSE"),
    "a6cba85bc92e0cff7a450b1d873c0eaa2e9fc96bf472df0247a26bec77bf3ff9",
  );
  assert.match(
    await readFile("services/morphic/LICENSE", "utf8"),
    /Copyright 2024 Yoshiki Miura/,
  );
  assert.equal(
    JSON.parse(await readFile("package.json", "utf8")).license,
    "MIT",
  );
  assert.match(
    await readFile("services/laya/requirements.txt", "utf8"),
    /^laya==0\.4\.6$/m,
  );
});

test("Morphic final Docker stage retains its license and adaptation attribution", async () => {
  const dockerfile = await readFile("services/morphic/Dockerfile", "utf8");
  const finalStage = dockerfile.slice(dockerfile.lastIndexOf("FROM "));
  for (const file of ["LICENSE", "NOTICE"]) {
    assert(finalStage.includes(`/app/services/morphic/${file} ${file}`));
  }
  const notice = await readFile("services/morphic/NOTICE", "utf8");
  assert.match(notice, /Copyright 2024 Yoshiki Miura/);
  assert.match(notice, /not an upstream NOTICE/);
});

test("offline reader preserves all original license and copyright texts byte for byte", async () => {
  const documents = await readLicenseDocuments();
  assert.equal(documents.length, 5);
  for (const [index, document] of documents.entries()) {
    assert.equal(
      document.content,
      await readFile(LICENSE_DOCUMENTS[index].path, "utf8"),
    );
    assert(document.content.length > 100);
  }
  assert.match(
    documents.find((document) => document.id === "siaas")!.content,
    /MIT License/,
  );
  assert.match(
    documents.find((document) => document.id === "morphic-notice")!.content,
    /SIAAS Personal headless research adapter/,
  );
});

test("About renders technology roles, independent-project disclosure and safe external links", () => {
  const html = renderToStaticMarkup(
    createElement(AboutSettings, { version: "1.2.0" }),
  );
  assert.match(html, /About/);
  assert.match(html, /Open Source &amp; Licenses/);
  assert.match(html, /Version.*1.2.0/);
  assert.match(html, /Advanced Reasoning/);
  assert.match(html, /optional Advanced Web Research/);
  assert.match(html, /independent project/);
  assert.match(html, /View Third-Party Notices/);
  const links = html.match(/<a\b[^>]*>/g)!;
  assert.equal(links.length, 3);
  for (const link of links) {
    assert.match(link, /href="https:\/\/github.com\//);
    assert.match(link, /target="_blank"/);
    assert.match(link, /rel="noopener noreferrer"/);
  }
  assert(
    !html.includes("TERMS AND CONDITIONS"),
    "Long texts must come from the original files on demand",
  );
});
