import {createHash} from 'node:crypto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectPreview} from '../lib/server/project-preview';
import {readFileSync} from 'node:fs';
test('project preview bundles real HTML assets and React without permitting host file imports',async()=>{
  const files=[{name:'index.html',language:'html',content:'<html><head><link rel="stylesheet" href="styles.css"></head><body><h1>Hello</h1><script src="app.js"></script></body></html>'},{name:'styles.css',language:'css',content:'h1 {color:blue}'},{name:'app.js',language:'javascript',content:'document.querySelector("h1").textContent="Preview works";'}];
  const result=await projectPreview(files);assert.equal(result.entry,'index.html');assert(result.html.includes('Preview works'));assert(result.html.includes('color:blue'));assert(result.html.includes("connect-src 'none'"));assert(!result.html.includes('src="app.js"'));
  const react=await projectPreview([{name:'src/App.tsx',language:'tsx',content:'export default function App(){return <h1>React preview works</h1>}'}]);assert(react.html.includes('React preview works'));
  await assert.rejects(projectPreview([{name:'main.js',language:'javascript',content:'import data from "../../../.env.local";console.log(data)'}]));
  await assert.rejects(projectPreview([{name:'main.js',language:'javascript',content:'import fs from "node:fs";console.log(fs)'}]));
  await assert.rejects(projectPreview([{name:'main.py',language:'python',content:'print("hello")'}]),/no browser entry/);
});
test('web scorer stays identical to the desktop shared policy',()=>{
  const manifest=JSON.parse(readFileSync('lib/server/desktop-providers/model-score.source.json','utf8'));assert.equal(createHash('sha256').update(readFileSync('lib/server/desktop-providers/model-score.ts')).digest('hex'),manifest.sha256);
});
