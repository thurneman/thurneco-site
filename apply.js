/* Ansökningsformulär på annonssidan. Ersätter mejl-knappen i careers.js.
   Skickar till Web3Forms som vidarebefordrar till autopilot@thurneco.se,
   där ATS-jobbet läser in kandidaten på rätt roll. Saknas nyckel används mejl. */
const THURNE_FORM_KEY='';
const THURNE_FORM_ENDPOINT='https://api.web3forms.com/submit';

const applyStyle=document.createElement('style');
applyStyle.textContent=`
.apply-form{margin-top:4px;padding:20px;background:var(--surface);border:1px solid var(--line);border-radius:3px;max-width:560px}
.apply-form h3{margin:0 0 6px;font-size:15px;font-weight:500}
.apply-form .apply-intro{font-size:12px;color:var(--muted);margin:0 0 18px}
.apply-grid{display:grid;gap:14px}
.apply-field label{font-size:12px;display:block;margin-bottom:6px}
.apply-field label span{color:var(--muted)}
.apply-field input{width:100%;box-sizing:border-box;border:1px solid var(--line);background:var(--deep);color:var(--text);border-radius:3px;padding:11px 13px;font-size:13px}
.apply-field input:focus{outline:none;border-color:var(--copper)}
.apply-actions{display:flex;align-items:center;gap:20px;flex-wrap:wrap;margin-top:18px}
.apply-actions .button{font-size:13px}
.apply-form .apply-note{font-size:11px;color:var(--muted);margin:14px 0 0}
.apply-status{font-size:13px;margin:0}
.apply-status.error{color:#e8a598}
.apply-done{padding:22px;background:var(--surface);border:1px solid var(--line);border-radius:3px;max-width:560px}
.apply-done h3{margin:0 0 8px;font-size:16px;font-weight:500}
.apply-done p{margin:0;font-size:13px;color:var(--muted)}
.apply-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
`;
document.head.append(applyStyle);

function applyFormHTML(job){
 const id=escapeHtml(job.id);
 const consulting=job.type==='consulting';
 return `<div class="job-application"><form class="apply-form" data-job-id="${id}" novalidate>
<h3>${consulting?'Anmäl intresse för uppdraget':'Ansök'}</h3>
<p class="apply-intro">Fyll i namn och LinkedIn-profil, resten är valfritt. Filip hör av sig.</p>
<div class="apply-grid">
<div class="apply-field"><label for="apply-name-${id}">Namn</label><input id="apply-name-${id}" name="name" type="text" autocomplete="name" required></div>
<div class="apply-field"><label for="apply-linkedin-${id}">LinkedIn-profil</label><input id="apply-linkedin-${id}" name="linkedin" type="url" inputmode="url" autocomplete="url" placeholder="https://www.linkedin.com/in/ditt-namn" required></div>
<div class="apply-field"><label for="apply-phone-${id}">Telefon <span>(valfritt)</span></label><input id="apply-phone-${id}" name="phone" type="tel" inputmode="tel" autocomplete="tel"></div>
<div class="apply-field"><label for="apply-cv-${id}">Länk till CV <span>(valfritt, t.ex. OneDrive, Google Drive eller Dropbox)</span></label><input id="apply-cv-${id}" name="cv" type="url" inputmode="url" placeholder="https://"></div>
</div>
<div class="apply-hp" aria-hidden="true"><input type="checkbox" name="botcheck" tabindex="-1" autocomplete="off"></div>
<div class="apply-actions"><button class="button" type="submit">${consulting?'Skicka intresseanmälan':'Skicka ansökan'} <svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></button><a class="text-link" href="tel:+46700172205">Frågor? Ring Filip</a></div>
<p class="apply-status" role="status" aria-live="polite"></p>
<p class="apply-note">Uppgifterna går till Thurne Consulting och används bara för den här rekryteringen.</p>
</form></div>`;
}

// careers.js definierar applicationHTML globalt och anropar den först när annonsen hämtats.
window.applicationHTML=applyFormHTML;

function validLinkedIn(value){
 try{const u=new URL(value.trim());return u.protocol==='https:'&&['linkedin.com','www.linkedin.com','se.linkedin.com'].includes(u.hostname.toLowerCase())&&/^\/in\/[^/]+\/?$/.test(u.pathname);}catch{return false;}
}

function normalizeLinkedIn(value){
 let v=value.trim();
 if(v&&!/^https?:\/\//i.test(v))v='https://'+v.replace(/^\/+/,'');
 return v;
}

function fallbackMail(job,data){
 const body=`Hej Filip,\n\nJag är intresserad av ${job.title}.\n\nNamn: ${data.name}\nLinkedIn: ${data.linkedin}\nTelefon: ${data.phone||'-'}\nCV: ${data.cv||'-'}\n\nVänliga hälsningar,\n${data.name}\n`;
 return `mailto:filip@thurneco.se?subject=${encodeURIComponent('Ansökan: '+job.title+' ['+job.id+']')}&body=${encodeURIComponent(body)}`;
}

document.addEventListener('submit',async e=>{
 const form=e.target.closest('.apply-form');
 if(!form)return;
 e.preventDefault();
 const status=form.querySelector('.apply-status');
 const job=((typeof jobs!=='undefined'&&Array.isArray(jobs))?jobs:[]).find(j=>j.id===form.dataset.jobId)||{id:form.dataset.jobId,title:document.title.replace(/ – Thurne Consulting$/,''),type:'recruitment'};
 const f=n=>form.elements.namedItem(n);
 const name=f('name').value.trim();
 const linkedinInput=f('linkedin');
 linkedinInput.value=normalizeLinkedIn(linkedinInput.value);
 const linkedin=linkedinInput.value;
 const phone=f('phone').value.trim();
 const cv=f('cv').value.trim();
 status.classList.remove('error');status.textContent='';
 if(!name){status.textContent='Skriv ditt namn.';status.classList.add('error');f('name').focus();return;}
 if(!validLinkedIn(linkedin)){status.textContent='Ange länken till din LinkedIn-profil, till exempel https://www.linkedin.com/in/ditt-namn';status.classList.add('error');linkedinInput.focus();return;}
 if(cv&&!/^https:\/\//i.test(cv)){status.textContent='CV-länken måste börja med https://';status.classList.add('error');f('cv').focus();return;}
 const data={name,linkedin,phone,cv};
 if(!THURNE_FORM_KEY){window.location.href=fallbackMail(job,data);return;}
 const button=form.querySelector('button[type=submit]');
 button.disabled=true;status.textContent='Skickar …';
 try{
  const res=await fetch(THURNE_FORM_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({
   access_key:THURNE_FORM_KEY,
   subject:`Ansökan: ${job.title} [${job.id}]`,
   from_name:'thurneco.se',
   job_id:job.id,job_title:job.title,job_type:job.type,
   name,linkedin,phone,cv,
   botcheck:f('botcheck').checked?'1':''
  })});
  const out=await res.json().catch(()=>({}));
  if(!res.ok||out.success===false)throw new Error(out.message||'Kunde inte skicka');
  form.outerHTML=`<div class="apply-done"><h3>Tack, ${escapeHtml(name)}.</h3><p>Din ${job.type==='consulting'?'intresseanmälan':'ansökan'} är mottagen. Filip återkommer via LinkedIn${phone?' eller telefon':''}.</p></div>`;
 }catch(err){
  button.disabled=false;
  status.classList.add('error');
  status.innerHTML=`Det gick inte att skicka just nu. <a href="${escapeHtml(fallbackMail(job,data))}">Skicka som mejl istället</a>.`;
 }
});
