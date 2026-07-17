const courses=[
['Practical AI Course','ChatGPT, Claude, Perplexity, Google Gemini, NotebookLM, Nano Banana and Google Flow','10,000','Flagship'],
['Content Generation AI Course','Google Nano Banana and Google Flow for AI image and video content creation','5,000','Creative'],
['NotebookLM Course','Research, learning, synthesis and knowledge workflows','3,000','Focused'],
['ChatGPT, Claude, Perplexity & Google Gemini Course','A practical multi-platform foundation for everyday AI work','5,000','Bundle'],
['Mastering ChatGPT','Practical prompting, productivity, content and workflow skills','3,000','Focused'],
['Mastering Google Gemini','Use Gemini effectively across Google-powered workflows','3,000','Focused'],
['Mastering Claude','Writing, analysis, reasoning and project workflows','3,000','Focused'],
['Mastering Perplexity','AI research, discovery and source-backed exploration','3,000','Focused'],
['AI Agents Course','Design goal-driven AI agents and useful automated systems','10,000','Advanced'],
['Agentic AI Course','Build advanced, multi-step autonomous AI workflows','10,000','Advanced']];
const grid=document.getElementById('courseGrid'),select=document.getElementById('courseSelect');
courses.forEach((c,i)=>{grid.insertAdjacentHTML('beforeend',`<article class="course-card"><div class="course-top"><span>${String(i+1).padStart(2,'0')}</span><b>${c[3]}</b></div><h2>${c[0]}</h2><p>${c[1]}</p><div class="fee"><small>COURSE FEE</small><b><small>PKR</small> ${c[2]}</b></div><div class="course-actions"><a class="btn primary" href="#demo">Book Free Demo</a><a class="btn outline" target="_blank" href="https://wa.me/923009254418?text=${encodeURIComponent('Assalam-o-Alaikum, I am interested in admission for the '+c[0]+'.')}">Admission via WhatsApp</a></div></article>`);select.insertAdjacentHTML('beforeend',`<option>${c[0]}</option>`)});
function route(){const name=location.hash.slice(1)||'home';document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.dataset.view===name));document.querySelectorAll('#nav a').forEach(a=>a.classList.toggle('active',a.getAttribute('href')==='#'+name));document.getElementById('nav').classList.remove('open');scrollTo(0,0)}
addEventListener('hashchange',route);route();document.getElementById('menu').onclick=()=>document.getElementById('nav').classList.toggle('open');
document.getElementById('demoForm').onsubmit=e=>{e.preventDefault();const d=new FormData(e.target);open('https://wa.me/923009254418?text='+encodeURIComponent(`Assalam-o-Alaikum, I would like to book a free demo class.\nName: ${d.get('name')}\nWhatsApp: ${d.get('contact')}\nCourse: ${d.get('course')}`),'_blank')};
document.getElementById('contactForm').onsubmit=e=>{e.preventDefault();const d=new FormData(e.target);open('https://wa.me/923009254418?text='+encodeURIComponent(`Assalam-o-Alaikum, I am contacting Aamir Patni AI Lab.\nName: ${d.get('name')}\nContact: ${d.get('contact')}\nMessage: ${d.get('message')}`),'_blank')};
