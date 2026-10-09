'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Check, Code2, FileCode2, Globe2, LayoutDashboard, Terminal, Workflow } from 'lucide-react';

const starters = [
  { title: 'Website', icon: Globe2, prompt: 'Build a responsive portfolio website with a clean white design, project gallery, and contact section.', files: ['index.html', 'styles.css', 'script.js'], description: 'A website that feels like you.' },
  { title: 'Dashboard', icon: LayoutDashboard, prompt: 'Build a responsive analytics dashboard with searchable data, filters, charts, and a CSV export using sample data.', files: ['src/App.tsx', 'src/styles.css', 'package.json'], description: 'Make your data easier to understand.' },
  { title: 'Python tool', icon: Terminal, prompt: 'Build a Python command-line tool that organizes files into folders by extension, with a dry-run option and a README.', files: ['organize.py', 'README.md', 'requirements.txt'], description: 'Turn repetitive work into one command.' },
];

export function MissionStarter() {
  const router = useRouter();
  const [selected, setSelected] = useState(0);
  const [prompt, setPrompt] = useState(starters[0].prompt);
  const current = starters[selected];
  return <div className="mission-starter">
    <div className="starter-heading"><span className="cinema-eyebrow">01 / YOUR IDEA STARTS HERE</span><span><Workflow size={14}/> BUILT WITH SWARM</span></div>
    <div className="starter-body">
      <div className="starter-compose">
        <h2>What will you<br/><span>make next?</span></h2>
        <div className="starter-presets" role="group" aria-label="Project ideas">{starters.map((item,i)=><button key={item.title} aria-pressed={selected===i} onClick={()=>{setSelected(i);setPrompt(item.prompt);}}><item.icon size={15}/>{item.title}</button>)}</div>
        <form onSubmit={e=>{e.preventDefault();if(prompt.trim())router.push('/app?mode=build&prompt='+encodeURIComponent(prompt.trim()));}}>
          <label htmlFor="homepage-project-prompt">DESCRIBE YOUR PROJECT</label>
          <textarea id="homepage-project-prompt" value={prompt} onChange={e=>setPrompt(e.target.value)} maxLength={6000} rows={4}/>
          <div className="starter-submit"><span>Make it yours. Then let SWARM build.</span><button className="cinema-button" disabled={!prompt.trim()} type="submit">Open in Build <ArrowUpRight size={16}/></button></div>
        </form>
      </div>
      <div className="starter-delivery" aria-live="polite">
        <div className="starter-project"><span className="starter-project-icon"><current.icon size={29} strokeWidth={1.4}/></span><div><small>STARTER CONCEPT</small><h3>{current.title}</h3><p>{current.description}</p></div></div>
        <div className="starter-pipeline">{['Plan','Code','Review','Package'].map((step,i)=><span key={step}><b>{String(i+1).padStart(2,'0')}</b>{step}</span>)}</div>
        <div className="starter-files"><div><Code2 size={15}/><strong>Example project structure</strong></div>{current.files.map(file=><p key={file}><FileCode2 size={15}/><span>{file}</span></p>)}</div>
        <div className="starter-download-note"><Check size={16}/><p>Keep every file.<br/><span>Download individually or as a project ZIP.</span></p></div>
      </div>
    </div>
    <div className="starter-footnote"><span>You direct the mission.</span><span>Actual files are generated after you send your request in Build.</span></div>
  </div>;
}
