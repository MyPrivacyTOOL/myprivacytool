import worker from './worker.js';
let calls=[]; let supa='ok'; let notionFail=false; let baselineRow=null;
globalThis.fetch = async (url, opts) => {
  calls.push({url:String(url), body: opts?.body});
  if (String(url).includes('challenges.cloudflare.com/turnstile/v0/siteverify')) {
    const tok=opts.body.get('response');
    if (tok==='throw') throw new Error('network down');
    if (tok==='down') return {ok:false,status:500,json:async()=>({}),text:async()=>''};
    if (tok==='wronghost') return {ok:true,status:200,json:async()=>({success:true,hostname:'evil.example'}),text:async()=>''};
    return {ok:true,status:200,json:async()=>tok==='good'?{success:true,hostname:'myprivacytool.io'}:{success:false,'error-codes':['invalid-input-response']},text:async()=>''};
  }
  if (String(url).includes('mpt_score_baselines')) {
    if (opts?.method==='POST') { if (baselineRow) return {ok:true,status:201,text:async()=>'',json:async()=>[]};
      const b=JSON.parse(opts.body); baselineRow={overall_score:b.overall_score,created_at:'2026-10-05T00:00:00Z'}; return {ok:true,status:201,text:async()=>'',json:async()=>[baselineRow]}; }
    return {ok:true,status:200,text:async()=>'',json:async()=>baselineRow?[baselineRow]:[]};
  }
  if (String(url).includes('supabase.co')) return supa==='ok' ? {ok:true,status:201,text:async()=>''} : {ok:false,status:500,text:async()=>'boom'};
  if (String(url).includes('api.notion.com/v1/pages')) return notionFail?{ok:false,text:async()=>'notion down'}:{ok:true,text:async()=>'',json:async()=>({})};
  return {ok:true,status:200,text:async()=>'',json:async()=>({results:[],has_more:false})};
};
const env={NOTION_TOKEN:'n',LEADS_DB_ID:'abc-def',SUPABASE_SERVICE_ROLE_KEY:'k',HUBSPOT_TOKEN:'h',RESEND_API_KEY:'r',SLACK_BOT_TOKEN:'s'};
async function run(body, e=env){ calls=[]; const waits=[]; const req=new Request('https://x/webhook/leads',{method:'POST',headers:{'content-type':'application/json',Origin:'https://myprivacytool.io'},body:JSON.stringify(body)});
  const res=await worker.fetch(req,e,{waitUntil:p=>waits.push(p)}); await Promise.all(waits); return {status:res.status, json:await res.json(), supa:calls.filter(c=>c.url.includes('supabase.co')&&!c.url.includes('mpt_score_baselines'))}; }
let ok=true; const check=(c,m)=>{console.log((c?'PASS':'FAIL'),m); if(!c) ok=false;};
let r=await run({email:'a@b.co',riskScore:42,confirmedCount:3,source:'web_scan'});
check(r.status===200&&r.json.success,'modal path returns success');
check(r.supa.length===1&&r.supa[0].url.endsWith('/rest/v1/mpt_user_engagement'),'one insert to mpt_user_engagement');
const b=JSON.parse(r.supa[0].body); check(b.full_scan_completed===true && typeof b.session_id==='string' && !('email' in b),'full_scan_completed=true, uuid session, no email');
r=await run({email:'a@b.co',name:'A B'}); check(JSON.parse(r.supa[0].body).full_scan_completed===false,'landing form (no riskScore) => full_scan_completed=false');
supa='fail'; r=await run({email:'a@b.co',riskScore:1}); check(r.status===200&&r.json.success,'Supabase 500 does not break lead capture');
supa='ok'; r=await run({email:'a@b.co',riskScore:1},{...env,SUPABASE_SERVICE_ROLE_KEY:undefined}); check(r.status===200&&r.supa.length===0,'missing key skips write, lead still succeeds');
r=await run({email:'x@healthcheck.io'}); check(r.json.note==='healthcheck'&&r.supa.length===0,'healthcheck email still short-circuits, no write');
// MPC-6971: consent fields reach HubSpot only when consent is explicit
const hs=()=>calls.filter(c=>c.url.includes('api.hubapi.com/crm/v3/objects/contacts')).map(c=>JSON.parse(c.body).properties);
await run({email:'c@d.co',consent:true,consent_source:'web_scan_summary'});
let hp=hs()[0]; check(hp&&/^\d{4}-\d{2}-\d{2}$/.test(hp.consent_given_at)&&hp.consent_source==='web_scan_summary','explicit consent => consent_given_at (date) + consent_source sent to HubSpot');
await run({email:'c@d.co',riskScore:5,source:'web_scan'}); hp=hs()[0]; check(hp&&!('consent_given_at' in hp)&&!('consent_source' in hp),'no consent flag => consent fields NOT sent');
await run({email:'c@d.co',consent:'false'}); hp=hs()[0]; check(hp&&!('consent_given_at' in hp),'consent="false" => not treated as consent');
await run({email:'c@d.co',consent:true,consent_source:'bad value<script>'}); hp=hs()[0]; check(hp&&hp.consent_source==='badvaluescript','consent_source is sanitised');
// MPC-7120: Notion failure must not block the engagement row
notionFail=true; r=await run({email:'n@f.co',riskScore:9}); notionFail=false;
check(r.status===500&&r.supa.length===1&&JSON.parse(r.supa[0].body).full_scan_completed===true,'Notion 500 => engagement row still written');
// MPC-7173: baseline snapshot
const bl=()=>calls.filter(c=>c.url.includes('mpt_score_baselines')&&c.body);
baselineRow=null; r=await run({email:'Base@Line.co',riskScore:40,categoryScores:{fingerprint:50,'bad key!':1,social:999}});
check(r.json.baseline?.is_first===true&&r.json.baseline.overall_score===40&&r.json.baseline.delta===0,'first scan creates baseline');
let bb=JSON.parse(bl()[0].body); check(/^[0-9a-f]{64}$/.test(bb.email_hash)&&!JSON.stringify(bb).includes('@')&&JSON.stringify(bb.category_scores)==='{"fingerprint":50}','baseline keyed by email hash, no raw email, invalid categories dropped');
r=await run({email:'base@line.co',riskScore:25}); check(r.json.baseline?.is_first===false&&r.json.baseline.overall_score===40&&r.json.baseline.delta===-15,'re-scan (case-insensitive email) shows baseline and delta, does not overwrite');
r=await run({email:'z@z.co'}); check(!('baseline' in r.json)&&bl().length===0,'no riskScore => no baseline write');
r=await run({email:'z@z.co',riskScore:140}); check(!('baseline' in r.json)&&bl().length===0,'out-of-range score => no baseline write');
r=await run({email:'z@z.co',riskScore:30},{...env,SUPABASE_SERVICE_ROLE_KEY:undefined}); check(r.status===200&&!('baseline' in r.json),'missing key => lead still succeeds, no baseline');
// MPC-7350: security hardening
const raw=async(body,{origin='https://myprivacytool.io',headers={},e=env}={})=>{ calls=[]; const waits=[]; const h={'content-type':'application/json',...headers}; if(origin) h.Origin=origin;
  const res=await worker.fetch(new Request('https://x/webhook/leads',{method:'POST',headers:h,body:typeof body==='string'?body:JSON.stringify(body)}),e,{waitUntil:p=>waits.push(p)}); await Promise.all(waits); return {status:res.status, json:await res.json(), cors:res.headers.get('access-control-allow-origin')}; };
r=await raw({email:'a@b.co'},{origin:'https://evil.example'}); check(r.status===403&&calls.length===0,'foreign browser Origin => 403, nothing written');
r=await raw({email:'not-an-email'}); check(r.status===400,'malformed email => 400');
r=await raw({email:'a@b.co'.padEnd(400,'x')+'.com'}); check(r.status===400,'oversized email => 400');
r=await raw('{not json'); check(r.status===400&&!JSON.stringify(r.json).includes('JSON'),'bad JSON => generic 400, no parser detail');
r=await raw({email:'a@b.co'},{headers:{'content-length':'999999'}}); check(r.status===413,'oversized body => 413');
notionFail=true; r=await raw({email:'n@f.co'}); notionFail=false; check(r.status===500&&!('detail' in r.json),'Notion failure does not leak upstream detail');
const limited={...env,RATE_LIMITER:{limit:async()=>({success:false})}}; r=await raw({email:'a@b.co'},{e:limited}); check(r.status===429,'rate limiter denial => 429');
const brokenRl={...env,RATE_LIMITER:{limit:async()=>{throw new Error('x')}}}; r=await raw({email:'a@b.co'},{e:brokenRl}); check(r.status===200,'rate limiter error fails open');
await raw({email:'a@b.co',name:'<b>x</b> & <https://evil|click>'}); const slack=calls.find(c=>c.url.includes('slack.com')); check(slack&&!/<b>|<https:/.test(JSON.parse(slack.body).text.split('\n').filter(l=>l.startsWith('Name:')).join('')),'Slack text escapes user-supplied < > &');
r=await raw({email:'a@b.co',referrer:'javascript:alert(1)'}); const nb=calls.find(c=>c.url.includes('api.notion.com/v1/pages')); check(r.status===200&&!JSON.parse(nb.body).properties.Referrer,'non-http(s) referrer dropped');

// CK-7721 fix 4: Slack carries no IP address or city; the Notion lead page is archived after 24 months, once a day.
{
  const slackCalls=()=>calls.filter(c=>c.url.includes('slack.com'));
  calls=[]; const waits=[]; const sreq=new Request('https://x/webhook/leads',{method:'POST',headers:{'content-type':'application/json',Origin:'https://myprivacytool.io','CF-Connecting-IP':'203.0.113.7'},body:JSON.stringify({email:'s@t.co',name:'S T',phone:'+85291234567'})});
  await worker.fetch(sreq,env,{waitUntil:p=>waits.push(p)}); await Promise.all(waits);
  const slackText=JSON.parse(slackCalls()[0].body).text;
  check(!slackText.includes('203.0.113.7')&&!/\bIP:/.test(slackText)&&!/City/i.test(slackText)&&!slackText.includes('s@t.co')&&!slackText.includes('S T')&&!slackText.includes('91234567')&&!/(Email|Name|Phone):/.test(slackText)&&slackText.includes('Total Leads')&&slackText.includes('Open Notion Leads DB'),'Slack lead post carries no name, email, phone, IP address or city, but keeps the count and the Notion link');
}
{
  const realFetch=globalThis.fetch; const seen=[];
  globalThis.fetch=async (url,opts)=>{ seen.push({url:String(url),method:opts?.method,body:opts?.body});
    if (String(url).includes('/databases/abc-def/query')) return {ok:true,status:200,json:async()=>({results:[{id:'old1'},{id:'old2'}]}),text:async()=>''};
    return {ok:true,status:200,json:async()=>({results:[],has_more:false}),text:async()=>''}; };
  const tick=async (iso)=>{ seen.length=0; const w=[]; await worker.scheduled({scheduledTime:Date.parse(iso)},env,{waitUntil:p=>w.push(p)}); await Promise.all(w); return seen.slice(); };
  let s1=await tick('2026-10-14T19:00:00Z');
  const q=s1.find(x=>x.url.includes('/databases/abc-def/query')); const cutoff=JSON.parse(q.body).filter.created_time.before;
  check(q&&cutoff.startsWith('2024-10-14T19:00'),'daily tick queries Notion for leads created before now minus 24 months');
  check(s1.filter(x=>x.method==='PATCH'&&/\/v1\/pages\/old[12]$/.test(x.url)&&JSON.parse(x.body).archived===true).length===2,'each lead page older than 24 months is archived');
  s1=await tick('2026-10-14T19:05:00Z'); check(!s1.some(x=>x.url.includes('/databases/abc-def/query')),'other 5-minute ticks do not run the retention purge');
  s1=await tick('2026-10-14T07:00:00Z'); check(!s1.some(x=>x.url.includes('/databases/abc-def/query')),'purge does not run at other hours');
  globalThis.fetch=async (url)=>({ok:false,status:500,json:async()=>({}),text:async()=>'x'});
  let threw=false; try { await tick('2026-10-14T19:00:00Z'); } catch { threw=true; } check(!threw,'a Notion failure during the purge never breaks the scheduled run');
  globalThis.fetch=realFetch;
}

// MPC-8368: Turnstile verification on the scan email form
{
  const ts=(tok,e)=>run({email:'t@t.co',riskScore:5,...(tok===undefined?{}:{'cf-turnstile-response':tok})},e);
  const sv=()=>calls.filter(c=>c.url.includes('siteverify'));
  const tsEnv={...env,TURNSTILE_SECRET_KEY:'sek'};
  let r=await ts(undefined,env); check(r.status===200&&sv().length===0,'no TURNSTILE_SECRET_KEY => feature off, no siteverify call, lead accepted');
  r=await ts('good',tsEnv); check(r.status===200&&sv().length===1,'valid token => siteverify called, lead accepted');
  const fdv=sv()[0].body; check(fdv.get('secret')==='sek'&&fdv.get('response')==='good','siteverify receives the secret and the token');
  r=await ts('bad',tsEnv); check(r.status===200,'report-only (TURNSTILE_ENFORCE unset): invalid token is logged, lead still accepted');
  r=await ts(undefined,tsEnv); check(r.status===200&&sv().length===0,'report-only: missing token is accepted without calling siteverify');
  const enf={...tsEnv,TURNSTILE_ENFORCE:'true'};
  r=await ts('bad',enf); check(r.status===403&&r.json.error==='Verification failed'&&r.supa.length===0,'enforce: invalid token => 403 and nothing written');
  r=await ts(undefined,enf); check(r.status===403&&r.supa.length===0,'enforce: missing token => 403 and nothing written');
  r=await ts('wronghost',enf); check(r.status===403,'enforce: token issued for another hostname => 403');
  r=await ts('good',enf); check(r.status===200&&r.json.success,'enforce: valid token => 200');
  r=await ts('throw',enf); check(r.status===200,'enforce: siteverify unreachable fails open (a Cloudflare outage never drops a lead)');
  r=await ts('down',enf); check(r.status===200,'enforce: siteverify HTTP 500 fails open');
  r=await run({email:'x@healthcheck.io'},enf); check(r.json.note==='healthcheck'&&sv().length===0,'enforce: watchdog health check needs no token');
  // form-encoded submits carry the token too
  calls=[]; const waits=[]; const fd=new FormData(); fd.set('email','f@f.co'); fd.set('cf-turnstile-response','good');
  const fr=await worker.fetch(new Request('https://x/webhook/leads',{method:'POST',headers:{Origin:'https://myprivacytool.io'},body:fd}),enf,{waitUntil:p=>waits.push(p)}); await Promise.all(waits);
  check(fr.status===200&&sv().length===1,'form-encoded submit: token read from cf-turnstile-response');
}

process.exit(ok?0:1);
