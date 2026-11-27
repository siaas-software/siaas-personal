import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { inspectSkillArchive } from "../src/lib/local/skill-archive";

const md="---\nname: review\ndescription: Review evidence\n---\nUse [notes](references/notes.md).";
async function pack(extra?: (zip:JSZip)=>void) {
  const zip=new JSZip();
  zip.file("review/SKILL.md",md);
  zip.file("review/references/notes.md","Check the evidence.");
  extra?.(zip);
  return zip.generateAsync({type:"nodebuffer",platform:"UNIX",compression:"DEFLATE"});
}
test("Markdown Skill ZIP retains its content identity across compression and rejects unsafe contents",async()=>{
  const content=await inspectSkillArchive(await pack());
  assert.equal(content.slug,"review");
  assert.equal(content.files["references/notes.md"],"Check the evidence.");
  for(const change of [
    (z:JSZip)=>z.file("review/references/Notes.md","duplicate"),
    (z:JSZip)=>z.file("review/references/large.md","x".repeat(40000)),
    (z:JSZip)=>z.file("review/references/link.md","target",{unixPermissions:0o120777}),
    (z:JSZip)=>z.file("review/../file.md","unsafe"),
    (z:JSZip)=>z.file("review/run.js","content"),
    (z:JSZip)=>z.file("review/SKILL.md",md.replace("name: review","name: wrong")),
    (z:JSZip)=>z.file("review/SKILL.md",md.replace("references/notes.md","https://example.org/")),
    (z:JSZip)=>z.file("review/SKILL.md",md.replace("references/notes.md","references/missing.md")),
    (z:JSZip)=>z.file("review/SKILL.md",md.replace("Review evidence","!unknown value")),
    (z:JSZip)=>z.file("review/references/bytes.md",Buffer.from([0xff])),
  ]) await assert.rejects(inspectSkillArchive(await pack(change)));
});
